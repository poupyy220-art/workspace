// CTO EDI 新專案表單草稿：只存在本機瀏覽器（localStorage），重新整理後帶回；不存檔案欄與人工確認勾選。
(function (root) {
  const KEY = 'ctoEdiFormDraft_v1';
  function create(storage, doc, ids, now) {
    const clock = now || (() => Date.now());
    const fields = () => ids.map(id => doc.getElementById(id)).filter(el => el && el.type !== 'file' && el.type !== 'checkbox');
    return {
      save() {
        const values = {};
        for (const el of fields()) values[ids.find(id => doc.getElementById(id) === el)] = el.value;
        if (!Object.values(values).some(v => String(v || '').trim())) return;
        try { storage.setItem(KEY, JSON.stringify({ savedAt: clock(), values })); } catch (e) { /* 無痕或禁止存取時略過 */ }
      },
      restore() {
        let draft = null;
        try { draft = JSON.parse(storage.getItem(KEY) || 'null'); } catch (e) { return null; }
        if (!draft || !draft.values) return null;
        for (const id of ids) {
          const el = doc.getElementById(id);
          if (el && el.type !== 'file' && el.type !== 'checkbox' && id in draft.values) el.value = draft.values[id];
        }
        return draft.savedAt || null;
      },
      clear() { try { storage.removeItem(KEY); } catch (e) { /* 略過 */ } }
    };
  }
  root.CtoEdiFormDraft = { create, KEY };
})(typeof window !== 'undefined' ? window : globalThis);
