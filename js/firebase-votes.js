(function (window) {
  "use strict";

  const VISITOR_ID_PREFIX = "campp_votes_visitor_";

  function randomId() {
    return "v_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function getVisitorId(appKey) {
    const key = VISITOR_ID_PREFIX + appKey;
    let value = localStorage.getItem(key);
    if (!value) {
      value = randomId();
      localStorage.setItem(key, value);
    }
    return value;
  }

  function toInt(value) {
    const num = parseInt(value, 10);
    if (Number.isNaN(num)) return 0;
    return num;
  }

  const CamppVotes = {
    ready: false,
    appKey: "",
    visitorId: "",
    db: null,

    init(config, appKey) {
      if (!window.firebase || !config || !appKey) {
        this.ready = false;
        return false;
      }

      try {
        this.appKey = appKey;
        this.visitorId = getVisitorId(appKey);

        let appInstance = null;
        if (window.firebase.apps && window.firebase.apps.length > 0) {
          appInstance = window.firebase.apps.find(function (item) {
            return item && item.options && item.options.appId === config.appId;
          }) || null;
        }

        if (!appInstance) {
          appInstance = window.firebase.initializeApp(config, "campp-votes-" + appKey);
        }

        this.db = window.firebase.firestore(appInstance);
        this.ready = true;
        return true;
      } catch (err) {
        console.error("CamppVotes init failed:", err);
        this.ready = false;
        return false;
      }
    },

    votesCollection(storeId) {
      return this.db
        .collection("apps")
        .doc(this.appKey)
        .collection("stores")
        .doc(storeId)
        .collection("votes");
    },

    async getUserVote(storeId) {
      if (!this.ready) return null;
      try {
        const snap = await this.votesCollection(storeId).doc(this.visitorId).get();
        if (!snap.exists) return null;
        return toInt(snap.data().stars);
      } catch (err) {
        console.error("CamppVotes getUserVote failed:", err);
        return null;
      }
    },

    async upsertVote(storeId, stars) {
      if (!this.ready) throw new Error("CamppVotes is not initialized");
      const normalized = Math.max(1, Math.min(5, toInt(stars)));
      await this.votesCollection(storeId).doc(this.visitorId).set(
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
      if (!this.ready) throw new Error("CamppVotes is not initialized");
      await this.votesCollection(storeId).doc(this.visitorId).delete();
      return true;
    },

    async getStoreSummary(storeId) {
      if (!this.ready) return { avg: 0, count: 0 };
      try {
        const snap = await this.votesCollection(storeId).get();
        let count = 0;
        let sum = 0;
        snap.forEach(function (doc) {
          const stars = toInt(doc.data().stars);
          if (stars >= 1 && stars <= 5) {
            sum += stars;
            count += 1;
          }
        });
        if (count === 0) return { avg: 0, count: 0 };
        return { avg: sum / count, count: count };
      } catch (err) {
        console.error("CamppVotes getStoreSummary failed:", err);
        return { avg: 0, count: 0 };
      }
    }
  };

  window.CamppVotes = CamppVotes;
})(window);
