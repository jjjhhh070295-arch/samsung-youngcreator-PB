// normalize 수정 전후 매칭 결과 비교
function normalizeBefore(s) {
  return s.replace(/\s+/g, "").replace(/[()（）\-_]/g, "");
}
function normalizeAfter(s) {
  return s
    .replace(/\s+/g, "")
    .replace(/[()（）\-_]/g, "")
    .replace(/단지|아파트|APT/gi, "")
    .replace(/고층|저층/g, "");
}

const inputName = "상계주공7단지";   // 사용자 입력
const apiNames  = ["상계주공7(고층)", "주공7"];

console.log("=== normalize 수정 전후 매칭 비교 ===\n");
console.log(`입력 단지명: "${inputName}"`);
console.log(`API 단지명:  ${JSON.stringify(apiNames)}\n`);

console.log("── 수정 전 ──");
const nBefore = normalizeBefore(inputName);
for (const n of apiNames) {
  const nb = normalizeBefore(n);
  const match = nb.includes(nBefore) || nBefore.includes(nb);
  console.log(`  "${n}" → normalize → "${nb}" | 매칭: ${match ? "✓" : "✗"}`);
}

console.log("\n── 수정 후 ──");
const nAfter = normalizeAfter(inputName);
console.log(`  inputName normalize → "${nAfter}"`);
for (const n of apiNames) {
  const na = normalizeAfter(n);
  const match = na.includes(nAfter) || nAfter.includes(na);
  console.log(`  "${n}" → normalize → "${na}" | 매칭: ${match ? "✓" : "✗"}`);
}

console.log("\n=== 추가 테스트 (오탐 방지) ===");
const falsePositives = [
  ["래미안", "래미안아이파크"],  // 일부 포함 → 오탐 위험
  ["주공7", "주공17"],           // 숫자 포함 주의
  ["상계주공7", "상계주공17단지"],
];
for (const [a, b] of falsePositives) {
  const na = normalizeAfter(a), nb = normalizeAfter(b);
  const match = na.includes(nb) || nb.includes(na);
  console.log(`  "${a}" vs "${b}" → 매칭: ${match ? "⚠ 매칭됨" : "✓ 안 매칭"}`);
}
