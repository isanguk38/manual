// 한국어 설명서 검색: 글자 2-gram 기반 BM25 (형태소 분석기 없이도 조사·어미 변화에 강함)

const SYNONYMS = {
  에러: ["오류", "check", "체크"],
  오류: ["에러", "check", "체크"],
  고장: ["수리", "보상"],
  크기: ["규격", "사양"],
  사이즈: ["규격", "사양"],
  치수: ["규격", "사양"],
  무게: ["중량", "사양", "kg"],
  전기: ["전기료", "소비전력", "전력"],
  빠져: ["빠지지"],
  안빠: ["빠지지"],
  스펙: ["사양", "규격"],
  사양: ["규격"],
  냄새: ["악취", "탈취", "필터"],
  악취: ["냄새", "탈취"],
  청소: ["세척"],
  세척: ["청소"],
  시간: ["동작시간", "처리시간"],
  용량: ["처리용량", "중량"],
  as: ["고객만족", "서비스센터", "1800-6307"],
  전화: ["고객만족", "1800-6307"],
  보증: ["보증기간", "품질", "무상"],
  환불: ["교환", "보상"],
  소리: ["소음", "음량"],
  볼륨: ["음량", "음소거"],
};

function words(text) {
  return text
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

export function tokenize(text, expand = false) {
  let ws = words(text);
  if (expand) {
    const extra = [];
    for (const w of ws) {
      for (const [key, syns] of Object.entries(SYNONYMS)) {
        if (w.includes(key)) extra.push(...syns);
      }
    }
    ws = ws.concat(words(extra.join(" ")));
  }
  const tokens = [];
  for (const w of ws) {
    if (w.length === 1) tokens.push(w);
    else for (let i = 0; i < w.length - 1; i++) tokens.push(w.slice(i, i + 2));
    if (/^[0-9a-z]+$/.test(w) && w.length > 2) tokens.push(w); // 영문·숫자는 단어 통째로도
  }
  return tokens;
}

export class BM25 {
  constructor(docs, { k1 = 1.4, b = 0.6 } = {}) {
    this.docs = docs;
    this.k1 = k1;
    this.b = b;
    this.tf = docs.map((d) => {
      const m = new Map();
      // 섹션 제목은 두 번 넣어 가중치 부여
      for (const t of tokenize(`${d.section} ${d.section} ${d.text}`)) m.set(t, (m.get(t) || 0) + 1);
      return m;
    });
    this.len = this.tf.map((m) => [...m.values()].reduce((a, c) => a + c, 0));
    this.avgLen = this.len.reduce((a, c) => a + c, 0) / docs.length;
    this.df = new Map();
    for (const m of this.tf) for (const t of m.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
  }

  idf(t) {
    const n = this.docs.length;
    const df = this.df.get(t) || 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  search(query, topK = 4) {
    const qTokens = [...new Set(tokenize(query, true))];
    const scores = this.tf.map((m, i) => {
      let s = 0;
      for (const t of qTokens) {
        const f = m.get(t);
        if (!f) continue;
        s += (this.idf(t) * f * (this.k1 + 1)) /
          (f + this.k1 * (1 - this.b + (this.b * this.len[i]) / this.avgLen));
      }
      return { doc: this.docs[i], score: s };
    });
    const ranked = scores.filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
    if (!ranked.length) return [];
    // 1등 대비 너무 낮은 점수는 버림 (관련 없는 조각이 AI를 헷갈리게 하지 않도록)
    const cutoff = ranked[0].score * 0.35;
    return ranked.filter((r) => r.score >= cutoff).slice(0, topK);
  }
}
