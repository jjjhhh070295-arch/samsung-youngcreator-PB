export type EntityKind = 'stock' | 'market' | 'asset_class' | 'sector' | 'etf';
export type SelectionKind = 'top_pick' | 'preference';
export type ExtractedCandidate = {
  id: string;
  entityName: string;
  kind: EntityKind;
  selection: SelectionKind;
  direction: 'positive' | 'negative' | 'unspecified';
  page: number;
  line: number;
  evidence: string;
};
export type ExtractResult = {
  status: 'candidates' | 'no_explicit_selection' | 'invalid_input';
  candidates: ExtractedCandidate[];
  warnings: string[];
};

type Header = Pick<ExtractedCandidate, 'selection' | 'direction'> & { body: string };
const KINDS: readonly EntityKind[] = ['stock', 'market', 'asset_class', 'sector', 'etf'];
const MAX_PAGES = 100;
const MAX_CHARACTERS = 200_000;
const MAX_CANDIDATES = 200;
const SELECTION_MARKER = /top\s*picks?|최선호주?|선호|overweight|underweight|비중\s*(?:확대|축소)/i;
const NEGATED_SELECTION = /\bno\s+top\s*picks?\b|\bnot\s+(?:a\s+)?top\s*pick\b|top\s*picks?\s*(?:이|은|는|가)?\s*아님|최선호주?\s*(?:이|은|는|가)?\s*아님/i;
const AMBIGUOUS_HEADER = /관심\s*(?:종목|주)|watch\s*list|및\s*기타|and\s+others/i;
const INVALID_ENTITY = /\b(?:buy|sell|hold|neutral|target|price|ignore|execute|eval|instructions?|recommendation)\b|매수|매도|목표\s*가|투자\s*의견|추천\s*이유|명령|실행|아님|https?:|javascript:/i;
// Construct at runtime to preserve the existing project's ES5 compilation target.
// Unicode property escapes still require the supported modern browser/Node runtime.
const HAS_LETTER = new RegExp('[\\p{L}]', 'u');
const ENTITY_CHARACTERS = new RegExp("^[\\p{L}\\p{N}\\s&().+'’\\-]+$", 'u');

function headerFor(line: string, kind: EntityKind): Header | null {
  // Only explicit whole-line headings are accepted; narrative mentions are not headings.
  const match = /^(Top\s*Picks?|최선호주|선호|비선호|Overweight|Underweight|비중\s*확대|비중\s*축소|선호\s*(?:업종|섹터)|비선호\s*(?:업종|섹터)|선호\s*자산군?|비선호\s*자산군?|선호\s*시장|비선호\s*시장)(?:\s*\((Overweight|Underweight)\))?(?:\s*[:：]\s*(.*))?$/i.exec(line);
  if (!match) return null;
  const label = match[1].replace(/\s/g, '').toLowerCase();
  if (label === '최선호주' && kind !== 'stock') return null;
  if ((label.endsWith('업종') || label.endsWith('섹터')) && kind !== 'sector') return null;
  if ((label.endsWith('자산') || label.endsWith('자산군')) && kind !== 'asset_class') return null;
  if (label.endsWith('시장') && kind !== 'market') return null;
  const topPick = label.startsWith('toppick') || label === '최선호주';
  if ((kind === 'stock' || kind === 'etf') && !topPick) return null;
  if (!topPick && match[2]) return null;
  const negative = label.startsWith('비선호') || label === 'underweight' || label === '비중축소';
  // A highlighted Top Pick can be an Underweight idea. Selection alone is not direction.
  const qualifier = match[2]?.toLowerCase();
  const direction = topPick
    ? qualifier === 'overweight' ? 'positive' : qualifier === 'underweight' ? 'negative' : 'unspecified'
    : negative ? 'negative' : 'positive';
  return { selection: topPick ? 'top_pick' : 'preference', direction, body: match[3] ?? '' };
}

function entityNames(body: string): string[] | null {
  const names = body.split(/[,，;；]/).map((part) => part.trim().replace(/\s+/g, ' '));
  // Reject the entire list if any item is ambiguous instead of silently returning a partial list.
  if (names.some((name) => !name || name.length > 100 || INVALID_ENTITY.test(name)
    || !HAS_LETTER.test(name) || !ENTITY_CHARACTERS.test(name)
    || name.split(/\s+/).length > 10 || /[?!=<>]/.test(name))) return null;
  return names;
}

function shortEvidence(text: string): string {
  return Array.from(text).slice(0, 250).join('');
}

/**
 * Extracts review candidates, not verified recommendations. No ticker resolution,
 * model inference, evaluation, persistence, or network access occurs here.
 * The caller supplies the entity kind; generic headings cannot establish that kind.
 */
export function extractIdeas(pages: readonly { page: number; text: string }[], kind: EntityKind): ExtractResult {
  const invalid = (reason: string): ExtractResult => ({ status: 'invalid_input', candidates: [], warnings: [reason] });
  if (!Array.isArray(pages) || !KINDS.includes(kind) || pages.length < 1 || pages.length > MAX_PAGES) return invalid('자료 종류와 페이지 수를 확인해 주세요. 1~100페이지를 입력할 수 있습니다.');
  let totalCharacters = 0;
  let hasText = false;
  const pageNumbers = new Set<number>();
  for (const page of pages) {
    if (!page || !Number.isSafeInteger(page.page) || page.page < 1 || typeof page.text !== 'string' || pageNumbers.has(page.page)) {
      return invalid('페이지 번호는 중복 없는 양의 정수여야 하며 각 페이지에는 텍스트가 필요합니다.');
    }
    pageNumbers.add(page.page);
    totalCharacters += page.text.length;
    hasText ||= /\S/.test(page.text);
    if (totalCharacters > MAX_CHARACTERS) return invalid('텍스트가 200,000자를 넘습니다. 자료를 나누어 확인해 주세요.');
  }
  if (!hasText) return invalid('읽을 수 있는 원문 텍스트가 없습니다. 빈 입력을 선정 종목 0개로 판단하지 않습니다.');

  const candidates: ExtractedCandidate[] = [];
  const warnings = new Set<string>();
  const seen = new Set<string>();
  const directions = new Map<string, Set<ExtractedCandidate['direction']>>();
  let overflow = false;
  const add = (body: string, header: Header, page: number, line: number, evidence: string) => {
    const names = entityNames(body);
    if (!names) {
      warnings.add(`${page}페이지 ${line}행: 목록이 모호하여 추출을 보류했습니다. 원문을 확인해 주세요.`);
      return;
    }
    for (const entityName of names) {
      const entityKey = `${kind}:${entityName.normalize('NFKC').toLocaleLowerCase('en-US')}`;
      const key = `${entityKey}:${header.selection}:${header.direction}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const existingDirections = directions.get(entityKey) ?? new Set<ExtractedCandidate['direction']>();
      if ((header.direction === 'positive' && existingDirections.has('negative')) || (header.direction === 'negative' && existingDirections.has('positive'))) {
        warnings.add(`${entityName}의 방향이 서로 반대입니다. 양쪽 후보를 유지하므로 원문의 기간과 시나리오를 확인해 주세요.`);
      }
      existingDirections.add(header.direction);
      directions.set(entityKey, existingDirections);
      if (candidates.length >= MAX_CANDIDATES) { overflow = true; return; }
      candidates.push({ id: `candidate-${page}-${line}-${candidates.length + 1}`, entityName, kind, selection: header.selection, direction: header.direction, page, line, evidence: shortEvidence(evidence) });
    }
  };

  for (const page of pages) {
    const lines = page.text.split(/\r\n|\n|\r/);
    let active: { header: Header; heading: string } | null = null;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (NEGATED_SELECTION.test(line)) { active = null; continue; }
      if (SELECTION_MARKER.test(line) && AMBIGUOUS_HEADER.test(line)) {
        warnings.add(`${page.page}페이지 ${index + 1}행: 선정 목록과 관심종목이 섞여 있어 추출을 보류했습니다.`);
        active = null;
        continue;
      }
      const header = headerFor(line, kind);
      if (header) {
        active = header.body ? null : { header, heading: line };
        if (header.body) add(header.body, header, page.page, index + 1, line);
      } else if (active) {
        const bullet = /^(?:[-*•·]|\d+[.)])\s+(.+)$/.exec(line);
        if (!bullet) { active = null; continue; }
        add(bullet[1], active.header, page.page, index + 1, `${active.heading}\n${line}`);
      }
      if (overflow) return invalid('후보가 200개를 넘습니다. 일부만 확정하지 않고 입력을 나누어 확인해 주세요.');
    }
  }
  if (candidates.length) warnings.add('원문 검토 전 추출 후보입니다. 자료 종류·원문 페이지·목표기간·시나리오·사용권을 확인해야 하며, 앱의 추천이나 매수 의견이 아닙니다.');
  return { status: candidates.length ? 'candidates' : 'no_explicit_selection', candidates, warnings: Array.from(warnings) };
}
