(function (window) {
  "use strict";

  const TRANSIENT_ERROR_CODES = [
    "unavailable",
    "network-request-failed",
    "permission-denied",
    "unauthenticated",
    "failed-precondition"
  ];

  const PHONE_PROVIDER = "phone";
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

  function createPhoneAuthRequiredError() {
    const err = new Error("Phone authentication is required before voting");
    err.code = "phone-auth-required";
    return err;
  }

  function shouldRetryWithVisibleRecaptcha(err) {
    if (!err) return false;
    const code = String(err.code || "").toLowerCase();
    const message = String(err.message || "").toLowerCase();
    const details = code + " " + message;
    return (
      details.indexOf("invalid-api-key") >= 0 ||
      details.indexOf("captcha-check-failed") >= 0 ||
      details.indexOf("recaptcha") >= 0 ||
      details.indexOf("invalid-app-credential") >= 0 ||
      details.indexOf("missing-app-credential") >= 0 ||
      details.indexOf("malformed") >= 0
    );
  }

  function hideRecaptchaContainerById(containerId) {
    const id = String(containerId || "").trim();
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.style.position = "fixed";
    el.style.left = "-9999px";
    el.style.top = "-9999px";
    el.style.transform = "";
    el.style.zIndex = "";
    el.style.background = "";
    el.style.padding = "";
    el.style.borderRadius = "";
    el.style.boxShadow = "";
  }

  const CamppVotes = {
    ready: false,
    appKey: "",
    uid: "",
    authProvider: "",
    app: null,
    db: null,
    auth: null,
    phoneConfirmationResult: null,
    phoneVerificationId: "",
    recaptchaVerifier: null,

    async init(config, appKey) {
      this.ready = false;
      this.appKey = "";
      this.uid = "";
      this.authProvider = "";
      this.app = null;
      this.db = null;
      this.auth = null;
      this.phoneConfirmationResult = null;
      this.phoneVerificationId = "";
      this.recaptchaVerifier = null;

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
        if (appCheck && typeof appCheck.activate === "function") {
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
      const phoneProvider = providers.find(function (item) {
        return item && item.providerId === PHONE_PROVIDER;
      });
      if (phoneProvider) return PHONE_PROVIDER;

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

    getCurrentProvider() {
      return this.authProvider || "";
    },

    isPhoneUser() {
      return this.getCurrentProvider() === PHONE_PROVIDER;
    },

    isPhoneVoteRequired() {
      const required = !!window.CAMPP_PHONE_AUTH_VOTE_REQUIRED;
      const coreAppKey = String(window.CAMPP_PHONE_AUTH_CORE_APP_KEY || "html-camppedidoscore-v1").trim();
      return required && !!coreAppKey && this.appKey === coreAppKey;
    },

    hasPhoneUserForVote() {
      if (!this.isPhoneVoteRequired()) return true;
      return !!this.uid && this.isPhoneUser();
    },

    supportsNativePhoneAutoFill() {
      const cap = window.Capacitor;
      const plugin = cap && cap.Plugins ? cap.Plugins.CamppPhoneAuth : null;
      return !!plugin;
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

    getOrCreateRecaptchaVerifier(containerId, options) {
      const opts = options || {};
      if (!this.auth) {
        throw new Error("Firebase auth is not initialized");
      }
      if (opts.forceReset) {
        this.clearRecaptchaVerifier();
      }
      if (this.recaptchaVerifier) {
        return this.recaptchaVerifier;
      }
      const authNs = window.firebase && window.firebase.auth;
      if (!authNs || typeof authNs.RecaptchaVerifier !== "function") {
        throw new Error("RecaptchaVerifier is not available");
      }

      const targetId = containerId || "campp-phone-recaptcha";
      let el = document.getElementById(targetId);
      if (!el) {
        el = document.createElement("div");
        el.id = targetId;
        document.body.appendChild(el);
      }

      if (opts.size === "normal") {
        el.style.position = "fixed";
        el.style.left = "50%";
        el.style.top = "50%";
        el.style.transform = "translate(-50%, -50%)";
        el.style.zIndex = "9999";
        el.style.background = "rgba(255,255,255,0.98)";
        el.style.padding = "10px";
        el.style.borderRadius = "12px";
        el.style.boxShadow = "0 10px 30px rgba(0,0,0,.25)";
      } else {
        el.style.position = "fixed";
        el.style.left = "-9999px";
        el.style.top = "-9999px";
        el.style.transform = "";
        el.style.zIndex = "";
        el.style.background = "";
        el.style.padding = "";
        el.style.borderRadius = "";
        el.style.boxShadow = "";
      }

      this.recaptchaVerifier = new authNs.RecaptchaVerifier(targetId, {
        size: opts.size === "normal" ? "normal" : "invisible"
      }, this.auth);
      return this.recaptchaVerifier;
    },

    async tryNativePhoneChallenge(phoneNumber) {
      const cap = window.Capacitor;
      const plugin = cap && cap.Plugins ? cap.Plugins.CamppPhoneAuth : null;
      if (!plugin) return null;

      try {
        let result = null;
        if (typeof plugin.requestPhoneChallenge === "function") {
          result = await plugin.requestPhoneChallenge({ phoneNumber: phoneNumber });
        } else if (typeof plugin.verifyPhoneNumber === "function") {
          result = await plugin.verifyPhoneNumber({ phoneNumber: phoneNumber });
        }

        if (!result || typeof result !== "object") return null;

        const verificationId = String(result.verificationId || "").trim();
        const smsCode = String(result.smsCode || result.code || "").trim();
        if (!verificationId) return null;

        this.phoneVerificationId = verificationId;

        if (smsCode) {
          await this.confirmPhoneChallenge(smsCode);
          return { autoVerified: true, source: "native" };
        }

        return { codeSent: true, source: "native" };
      } catch (err) {
        console.warn("CamppVotes native phone auth hook failed; using web fallback.", err);
        return null;
      }
    },

    async requestPhoneChallenge(phoneNumber, options) {
      const opts = options || {};
      if (!this.auth) {
        throw new Error("Firebase auth is not initialized");
      }

      if (this.hasPhoneUserForVote()) {
        return { alreadyVerified: true };
      }

      const normalizedPhone = String(phoneNumber || "").trim();
      if (!normalizedPhone) {
        const err = new Error("Phone number is required");
        err.code = "phone-number-required";
        throw err;
      }

      const nativeResult = await this.tryNativePhoneChallenge(normalizedPhone);
      if (nativeResult && (nativeResult.autoVerified || nativeResult.codeSent)) {
        return nativeResult;
      }

      const mode = String(opts.recaptchaMode || "invisible").toLowerCase();
      const verifier = this.getOrCreateRecaptchaVerifier(opts.recaptchaContainerId, {
        size: mode === "visible" ? "normal" : "invisible",
        forceReset: !!opts.forceRecaptchaReset
      });

      try {
        this.phoneConfirmationResult = await this.auth.signInWithPhoneNumber(normalizedPhone, verifier);
        this.phoneVerificationId = "";
        if (mode === "visible") {
          hideRecaptchaContainerById(opts.recaptchaContainerId || "campp-phone-recaptcha-visible");
        }
        return { codeSent: true, source: mode === "visible" ? "web-visible" : "web" };
      } catch (err) {
        if (mode !== "visible" && !opts.disableVisibleRecaptchaFallback && shouldRetryWithVisibleRecaptcha(err)) {
          this.clearRecaptchaVerifier();
          const visibleContainerId = opts.visibleRecaptchaContainerId || "campp-phone-recaptcha-visible";
          const visibleVerifier = this.getOrCreateRecaptchaVerifier(visibleContainerId, {
            size: "normal",
            forceReset: true
          });
          this.phoneConfirmationResult = await this.auth.signInWithPhoneNumber(normalizedPhone, visibleVerifier);
          this.phoneVerificationId = "";
          hideRecaptchaContainerById(visibleContainerId);
          return { codeSent: true, source: "web-visible-fallback" };
        }
        throw err;
      }
    },

    async confirmPhoneChallenge(code) {
      if (!this.auth) {
        throw new Error("Firebase auth is not initialized");
      }

      if (this.hasPhoneUserForVote()) {
        return true;
      }

      const normalizedCode = String(code || "").trim();
      if (!normalizedCode) {
        const err = new Error("OTP code is required");
        err.code = "otp-required";
        throw err;
      }

      if (this.phoneVerificationId) {
        const authNs = window.firebase && window.firebase.auth;
        if (!authNs || !authNs.PhoneAuthProvider || typeof authNs.PhoneAuthProvider.credential !== "function") {
          throw new Error("PhoneAuthProvider is not available");
        }
        const credential = authNs.PhoneAuthProvider.credential(this.phoneVerificationId, normalizedCode);
        await this.auth.signInWithCredential(credential);
        this.phoneVerificationId = "";
        this.phoneConfirmationResult = null;
        this.syncAuthState(this.auth.currentUser);
        return this.hasPhoneUserForVote();
      }

      if (!this.phoneConfirmationResult || typeof this.phoneConfirmationResult.confirm !== "function") {
        const err = new Error("No pending phone verification challenge");
        err.code = "phone-challenge-missing";
        throw err;
      }

      await this.phoneConfirmationResult.confirm(normalizedCode);
      this.phoneConfirmationResult = null;
      this.phoneVerificationId = "";
      this.syncAuthState(this.auth.currentUser);
      return this.hasPhoneUserForVote();
    },

    clearPhoneChallenge() {
      this.phoneConfirmationResult = null;
      this.phoneVerificationId = "";
    },

    clearRecaptchaVerifier() {
      if (this.recaptchaVerifier) {
        try {
          if (typeof this.recaptchaVerifier.clear === "function") {
            this.recaptchaVerifier.clear();
          }
        } catch (_) {}
      }
      this.recaptchaVerifier = null;
      hideRecaptchaContainerById("campp-phone-recaptcha");
      hideRecaptchaContainerById("campp-phone-recaptcha-visible");
    },

    assertCanVote() {
      if (!this.ready || !this.uid) {
        throw new Error("CamppVotes is not initialized");
      }
      if (this.isPhoneVoteRequired() && !this.hasPhoneUserForVote()) {
        throw createPhoneAuthRequiredError();
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
