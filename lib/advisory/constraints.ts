import type { AdvisoryConstraint, ProductCategory } from "./types";

const CATEGORY_PATTERNS: Array<{ key: ProductCategory | "wrap"; re: RegExp }> = [
  { key: "trust", re: /신탁만|신탁만\s*고려|신탁\/랩|랩만|일임만|일임형만|wrap only|trust only/i },
  { key: "wrap", re: /랩\s*만|일임형|discretionary|wrap/i },
  { key: "etf", re: /etf만|etf only/i },
  { key: "els", re: /els만|elb만|els\/elb만/i },
  { key: "stock", re: /개별주식만|개별주만|주식만\s*고려/i },
  { key: "bond", re: /채권만|bond only/i },
  { key: "pension", re: /연금만|irp만/i },
];

export function parseAdvisoryConstraints(...texts: Array<string | null | undefined>): AdvisoryConstraint {
  const rawText = texts.filter(Boolean).join(" \n ");
  const lower = rawText.toLowerCase();

  let categoryOnly: AdvisoryConstraint["categoryOnly"] = null;
  for (const pattern of CATEGORY_PATTERNS) {
    if (pattern.re.test(rawText)) {
      categoryOnly = pattern.key;
      break;
    }
  }

  const overseasOnly = /해외주식만|해외만|미국주식만|overseas only|us only|해외\s*주식\s*만/.test(lower);
  const preferIndividualStocks = /개별주식 선호|개별주 선호|단일종목|개별종목 선호|stock picking/.test(lower);

  let minExpectedReturn: number | null = null;
  const returnMatch =
    rawText.match(/기대수익률\s*(\d+(?:\.\d+)?)\s*%\s*이상/) ||
    rawText.match(/연\s*(\d+(?:\.\d+)?)\s*%\s*이상/) ||
    rawText.match(/target(?:ed)?\s*return\s*(\d+(?:\.\d+)?)\s*%/i) ||
    rawText.match(/수익률\s*(\d+(?:\.\d+)?)\s*%\s*이상/);
  if (returnMatch) minExpectedReturn = Number(returnMatch[1]);

  const tags: string[] = [];
  if (categoryOnly === "trust" || categoryOnly === "wrap") tags.push("신탁/랩/일임만");
  else if (categoryOnly) tags.push(`${categoryOnly}만`);
  if (overseasOnly) tags.push("해외주식만");
  if (preferIndividualStocks) tags.push("개별주식 선호");
  if (minExpectedReturn != null) tags.push(`기대수익률 ${minExpectedReturn}% 이상`);

  return {
    rawText,
    categoryOnly,
    overseasOnly,
    minExpectedReturn,
    preferIndividualStocks,
    tags,
  };
}

export function constraintAppliesToCategory(
  constraints: AdvisoryConstraint,
  category: ProductCategory,
  overseas: boolean,
): boolean {
  if (constraints.categoryOnly === "trust" || constraints.categoryOnly === "wrap") {
    return category === "trust";
  }
  if (constraints.categoryOnly && constraints.categoryOnly !== category) return false;
  if (constraints.overseasOnly && !overseas && category !== "trust") return false;
  if (constraints.preferIndividualStocks && constraints.categoryOnly == null) {
    // 선호이지 배제가 아님. 필터에서는 통과시키고 랭킹에서 가중.
    return true;
  }
  return true;
}
