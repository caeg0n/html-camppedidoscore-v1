(function (window) {
  "use strict";

  const TRANSIENT_ERROR_CODES = [
    "unavailable",
    "network-request-failed",
    "permission-denied",
    "unauthenticated",
    "failed-precondition"
  ];

  const ANONYMOUS_PROVIDER = "anonymous";

  function toInt(value) {
    const num = parseInt(value, 10);
    if (Number.isNaN(num)) return 0;
    return num;
  }

  function toFloat(value) {
    const num = Number(value);
    if (Number.isNaN(num)) return 0;
    return num;
  }

  function hasRequiredConfig(config) {
    if (!config) return false;
    return !!(
      config.apiKey &&
      config.authDomain &&
      config.projectId &&
      config.appId
    );
  }

  function shouldEscalateError(err) {
    if (!err) return false;
    const code = String(err.code || "").toLowerCase();
    const message = String(err.message || "").toLowerCase();
    if (TRANSIENT_ERROR_CODES.indexOf(code) >= 0) return true;
    return (
      message.indexOf("offline") >= 0 ||
      message.indexOf("network") >= 0 ||
      message.indexOf("app check") >= 0 ||
      message.indexOf("appcheck") >= 0
    );
  }

  const CamppVotes = {
    ready: false,
    appKey: "",
    uid: "",
    authProvider: "",
    app: null,
    db: null,
    auth: null,

    async init(config, appKey) {
      this.ready = false;
      this.appKey = "";
      this.uid = "";
      this.authProvider = "";
      this.app = null;
      this.db = null;
      this.auth = null;

      if (!window.firebase || !appKey || !hasRequiredConfig(config)) {
        return false;
      }

      try {
        this.appKey = appKey;
        this.app = this.resolveApp(config, appKey);
        this.setupAppCheck(this.app);
        this.auth = window.firebase.auth(this.app);
        this.db = window.firebase.firestore(this.app);

        this.auth.onAuthStateChanged((user) => {
          this.syncAuthState(user);
        });

        try {
          await this.ensureAnonymousUser();
        } catch (authErr) {
          // Keep summary reads available even when anonymous auth is not enabled.
          console.warn("CamppVotes anonymous auth unavailable; summary read-only mode enabled.", authErr);
          this.syncAuthState(null);
        }

        this.ready = true;
        return true;
      } catch (err) {
        console.error("CamppVotes init failed:", err);
        this.ready = false;
        return false;
      }
    },

    resolveApp(config, appKey) {
      let appInstance = null;
      if (window.firebase.apps && window.firebase.apps.length > 0) {
        appInstance = window.firebase.apps.find(function (item) {
          return item && item.options && item.options.appId === config.appId;
        }) || null;
      }

      if (appInstance) return appInstance;
      return window.firebase.initializeApp(config, "campp-votes-" + appKey);
    },

    setupAppCheck(appInstance) {
      const siteKey = String(window.CAMPP_APP_CHECK_SITE_KEY || "").trim();
      if (!siteKey) return;
      if (!window.firebase.appCheck) return;

      try {
        const appCheck = window.firebase.appCheck(appInstance);
        if (!appCheck) return;
        const ac = window.firebase.appCheck;
        if (ac.ReCaptchaEnterpriseProvider && typeof appCheck.activate === "function") {
          appCheck.activate(new ac.ReCaptchaEnterpriseProvider(siteKey), true);
        } else if (typeof appCheck.activate === "function") {
          appCheck.activate(siteKey, true);
        }
      } catch (err) {
        console.warn("CamppVotes App Check setup warning:", err);
      }
    },

    inferProvider(user) {
      if (!user) return "";
      if (user.isAnonymous) return ANONYMOUS_PROVIDER;

      const providers = Array.isArray(user.providerData) ? user.providerData : [];
      if (providers.length > 0 && providers[0] && providers[0].providerId) {
        return String(providers[0].providerId);
      }
      return "";
    },

    syncAuthState(user) {
      const authUser = user || (this.auth && this.auth.currentUser) || null;
      if (!authUser || !authUser.uid) {
        this.uid = "";
        this.authProvider = "";
        return;
      }
      this.uid = authUser.uid;
      this.authProvider = this.inferProvider(authUser);
    },

    async ensureAnonymousUser() {
      if (!this.auth) {
        throw new Error("Firebase auth is not initialized");
      }

      if (this.auth.currentUser && this.auth.currentUser.uid) {
        this.syncAuthState(this.auth.currentUser);
        return this.auth.currentUser.uid;
      }

      const credential = await this.auth.signInAnonymously();
      const user = (credential && credential.user) || this.auth.currentUser;
      if (!user || !user.uid) {
        throw new Error("Anonymous auth failed to provide uid");
      }
      this.syncAuthState(user);
      return user.uid;
    },

    votesDoc(storeId) {
      return this.db
        .collection("apps")
        .doc(this.appKey)
        .collection("stores")
        .doc(storeId)
        .collection("votes")
        .doc(this.uid);
    },

    aggregateDoc(storeId) {
      return this.db
        .collection("apps")
        .doc(this.appKey)
        .collection("stores")
        .doc(storeId)
        .collection("stats")
        .doc("aggregate");
    },

    assertCanVote() {
      if (!this.ready || !this.uid) {
        throw new Error("CamppVotes is not initialized");
      }
    },

    async getUserVote(storeId) {
      if (!this.ready || !this.uid) return null;
      try {
        const snap = await this.votesDoc(storeId).get();
        if (!snap.exists) return null;
        return toInt(snap.data().stars);
      } catch (err) {
        if (shouldEscalateError(err)) {
          throw err;
        }
        console.error("CamppVotes getUserVote failed:", err);
        return null;
      }
    },

    async upsertVote(storeId, stars) {
      this.assertCanVote();

      const normalized = Math.max(1, Math.min(5, toInt(stars)));
      await this.votesDoc(storeId).set(
        {
          stars: normalized,
          updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
          appKey: this.appKey,
          storeId: storeId
        },
        { merge: true }
      );
      return normalized;
    },

    async clearVote(storeId) {
      this.assertCanVote();
      await this.votesDoc(storeId).delete();
      return true;
    },

    async getStoreSummary(storeId) {
      if (!this.ready) return { avg: 0, count: 0, sum: 0 };
      try {
        const snap = await this.aggregateDoc(storeId).get();
        if (!snap.exists) return { avg: 0, count: 0, sum: 0 };
        const data = snap.data() || {};
        return {
          avg: toFloat(data.avg),
          count: Math.max(0, toInt(data.count)),
          sum: Math.max(0, toInt(data.sum))
        };
      } catch (err) {
        if (shouldEscalateError(err)) {
          throw err;
        }
        console.error("CamppVotes getStoreSummary failed:", err);
        return { avg: 0, count: 0, sum: 0 };
      }
    }
  };

  window.CamppVotes = CamppVotes;
})(window);
