import ExcelJS from "exceljs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, "public", "templates", "cashflow");

const yellowFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3C4" } };
const sectionFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F1FF" } };
const headerFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
const mutedFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
const border = {
  top: { style: "thin", color: { argb: "FFD1D5DB" } },
  left: { style: "thin", color: { argb: "FFD1D5DB" } },
  bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
  right: { style: "thin", color: { argb: "FFD1D5DB" } },
};

const commonUploadRows = [
  ["근로소득", 2800, "2026-01", "월소득"],
  ["상여 및 성과금", 6000, "2026-12", "월소득"],
  ["금융소득", 2500, "2026-12", "월소득"],
  ["월임대수입", 1200, "2026-01", "월소득"],
  ["부수입", 300, "2026-01", "월소득"],
  ["생활비", 900, "2026-01", "월지출"],
  ["월세/관리비", 350, "2026-01", "월지출"],
  ["보험료 지출", 250, "2026-01", "월지출"],
  ["자녀학자금", 2000, "2026-03", "월지출"],
  ["부모님 용돈", 300, "2026-01", "월지출"],
  ["차량비", 180, "2026-01", "월지출"],
  ["통신비", 60, "2026-01", "월지출"],
  ["경조사비", 120, "2026-05", "월지출"],
  ["휴가비용", 1500, "2026-08", "월지출"],
  ["명절선물", 500, "2026-09", "월지출"],
  ["정기적금", 700, "2026-01", "저축투자"],
  ["CMA", 1500, "2026-01", "저축투자"],
  ["주택청약", 50, "2026-01", "저축투자"],
  ["적립식 ETF", 1000, "2026-01", "저축투자"],
  ["연금저축", 150, "2026-01", "저축투자"],
  ["IRP", 100, "2026-01", "저축투자"],
  ["ISA", 200, "2026-01", "저축투자"],
  ["국내주식", 2500, "2026-02", "저축투자"],
  ["해외주식", 3000, "2026-02", "저축투자"],
  ["비상금", 500, "2026-01", "저축투자"],
  ["재산세", 1800, "2026-07", "세금"],
  ["종부세", 6500, "2026-12", "세금"],
  ["종합소득세", 5200, "2027-05", "세금"],
  ["지방소득세", 520, "2027-05", "세금"],
  ["건강보험정산", 900, "2027-05", "세금"],
  ["자동차세", 120, "2026-06", "세금"],
  ["현재현금성자산", 90000, "2026-01", "자산"],
  ["대출잔액", 150000, "2026-01", "부채"],
  ["월원금상환", 1200, "2026-01", "부채"],
  ["부동산매각일", "2026-10-31", "2026-10", "세금일정"],
  ["부동산양도세예상액", 45000, "2026-12", "세금일정"],
  ["증여예정일", "2026-06-30", "2026-06", "세금일정"],
  ["증여실행금액", 200000, "2026-06", "세금일정"],
  ["증여세예상액", 32000, "2026-09", "세금일정"],
  ["상속개시일", "2026-02-28", "2026-02", "세금일정"],
  ["상속세예상액", 120000, "2026-08", "세금일정"],
  ["해외주식매도연도", 2026, "2026-12", "세금일정"],
  ["해외주식양도세예상액", 8000, "2027-05", "세금일정"],
  ["IPO보호예수해제일", "2026-11-15", "2026-11", "세금일정"],
  ["M&A클로징일", "2026-09-30", "2026-09", "세금일정"],
  ["엑싯현금화예비액", 60000, "2026-09", "세금일정"],
];

const typeSpecificRows = {
  individual: [
    ["개인 배당", 15000, "2026-04", "월소득"],
    ["가족 생활비", 1800, "2026-01", "월지출"],
    ["주택구입 계약금", 80000, "2026-05", "월지출"],
    ["자녀 유학비", 30000, "2026-08", "월지출"],
    ["개인 양도세 납부 예비", 22000, "2026-11", "세금"],
    ["단기채 예치", 20000, "2026-02", "저축투자"],
    ["MMF 세금 예비", 18000, "2026-03", "저축투자"],
    ["가족 증여 재원", 50000, "2026-06", "세금일정"],
  ],
  corporate: [
    ["매출입금", 45000, "2026-01", "월소득"],
    ["법인세예상액", 85000, "2027-03", "세금일정"],
    ["사업연도종료일", "2026-12-31", "2026-12", "세금일정"],
    ["배당지급", 40000, "2026-04", "월지출"],
    ["급여지급", 12000, "2026-01", "월지출"],
    ["운영비", 18000, "2026-01", "월지출"],
    ["CAPEX 투자", 70000, "2026-07", "월지출"],
    ["법인 MMF", 60000, "2026-01", "저축투자"],
    ["법인 RP", 35000, "2026-01", "저축투자"],
  ],
  sole_proprietor: [
    ["사업매출", 18000, "2026-01", "월소득"],
    ["사업비용", 9500, "2026-01", "월지출"],
    ["개인인출", 2500, "2026-01", "월지출"],
    ["통장혼용지출", 1200, "2026-01", "월지출"],
    ["부가세 예비", 4800, "2026-07", "세금"],
    ["종합소득세 예비", 14500, "2027-05", "세금"],
    ["사업자 CMA", 12000, "2026-01", "저축투자"],
    ["재고 매입", 7000, "2026-02", "월지출"],
    ["사업자통장 잔액", 30000, "2026-01", "자산"],
  ],
  linked_corporate_rep: [
    ["대표 급여", 2500, "2026-01", "월소득"],
    ["법인 배당 유입", 35000, "2026-04", "월소득"],
    ["법인 배당 지급", 35000, "2026-04", "월지출"],
    ["법인세예상액", 95000, "2027-03", "세금일정"],
    ["사업연도종료일", "2026-12-31", "2026-12", "세금일정"],
    ["대표 증여 계획", 120000, "2026-06", "세금일정"],
    ["오너 법인 운영비", 22000, "2026-01", "월지출"],
    ["오너 법인 현금성자산", 130000, "2026-01", "자산"],
    ["개인 현금성자산", 70000, "2026-01", "자산"],
  ],
};

const configs = [
  {
    key: "individual",
    file: "vvip-cashflow-individual.xlsx",
    title: "VVIP 개인 고객 현금흐름표",
    purpose: "개인 고객의 생활비, 세금 납부, 증여·상속·부동산 현금화 일정을 분리해 포트폴리오 유동성 버킷 산출에 사용합니다.",
    subject: "개인",
    accountNote: "개인통장, CMA, 증권계좌, 연금계좌를 구분합니다.",
  },
  {
    key: "corporate",
    file: "vvip-cashflow-corporate.xlsx",
    title: "VVIP 법인 고객 현금흐름표",
    purpose: "법인 운영자금, 법인세, 배당 지급, CAPEX, 단기 운용 가능 현금을 분리해 법인 자금 운용 상담에 사용합니다.",
    subject: "법인",
    accountNote: "법인통장, 법인 MMF/RP, 운전자금 계좌, 세금 예치 계좌를 구분합니다.",
  },
  {
    key: "sole_proprietor",
    file: "vvip-cashflow-sole-proprietor.xlsx",
    title: "VVIP 개인사업자 현금흐름표",
    purpose: "사업 매출·비용, 개인 인출, 통장 혼용 지출을 구분해 투자 가능 현금을 보수적으로 산출합니다.",
    subject: "개인사업자",
    accountNote: "사업자통장/개인통장 혼용 여부를 반드시 표시합니다.",
  },
  {
    key: "linked_corporate_rep",
    file: "vvip-cashflow-linked-corporate-rep.xlsx",
    title: "VVIP 법인-대표 연동 현금흐름표",
    purpose: "대표 개인과 오너 법인의 급여·배당·법인세·현금화 일정을 함께 보되 중복 반영을 방지합니다.",
    subject: "법인-대표 연동",
    accountNote: "법인 배당 지급과 대표 개인 배당 유입은 같은 기준월 메모로 연결합니다.",
  },
];

function setTitle(ws, title, purpose) {
  ws.mergeCells("A1:K1");
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { bold: true, size: 18, color: { argb: "FF111827" } };
  ws.getCell("A1").alignment = { horizontal: "center" };
  ws.mergeCells("A2:K2");
  ws.getCell("A2").value = purpose;
  ws.getCell("A2").font = { size: 10, color: { argb: "FF4B5563" } };
  ws.getCell("A2").alignment = { horizontal: "center", wrapText: true };
}

function section(ws, row, title) {
  ws.mergeCells(`A${row}:K${row}`);
  const cell = ws.getCell(`A${row}`);
  cell.value = title;
  cell.font = { bold: true, color: { argb: "FF0F172A" } };
  cell.fill = sectionFill;
  cell.border = border;
  return row + 1;
}

function styleHeader(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = headerFill;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = border;
  });
}

function styleInputRow(row, inputColumns = []) {
  row.eachCell((cell, colNumber) => {
    cell.border = border;
    cell.alignment = { vertical: "middle", wrapText: true };
    if (inputColumns.includes(colNumber)) cell.fill = yellowFill;
  });
}

function addKeyValueBlock(ws, row, entries) {
  entries.forEach(([label, value, note]) => {
    const values = [label, value, note ?? ""];
    const added = ws.getRow(row);
    added.values = values;
    styleInputRow(added, [2]);
    added.getCell(1).font = { bold: true };
    row += 1;
  });
  return row;
}

function addTable(ws, row, headers, rows, inputColumns) {
  const header = ws.getRow(row);
  header.values = headers;
  styleHeader(header);
  row += 1;
  rows.forEach((values) => {
    const added = ws.getRow(row);
    added.values = values;
    styleInputRow(added, inputColumns);
    row += 1;
  });
  return row;
}

function uploadRowsFor(key) {
  const rows = [...commonUploadRows, ...typeSpecificRows[key]];
  let index = 1;
  while (rows.length < 56) {
    rows.push([`추가 상담 항목 ${index}`, index % 2 ? 0 : 1000, "2026-01", index % 2 ? "월지출" : "월소득"]);
    index += 1;
  }
  return rows;
}

function mainCashflowRows(config) {
  const entity = config.key === "corporate" ? "법인" : config.key === "sole_proprietor" ? "개인사업자" : "개인";
  const account = config.key === "corporate" ? "법인 MMF" : config.key === "sole_proprietor" ? "사업자통장" : "개인 CMA";
  return [
    ["2026-01", "정기", config.key === "corporate" ? "매출입금" : config.key === "sole_proprietor" ? "사업매출" : "근로소득", entity, account, "유입", 2800, "소득/매출", "매월", "세전/세후 구분 메모", "Y"],
    ["2026-01", "정기", config.key === "corporate" ? "운영비" : config.key === "sole_proprietor" ? "사업비용" : "생활비", entity, account, "유출", 900, "비용", "매월", "비용처리 확정 아님", "Y"],
    ["2026-03", "일회", "자녀학자금/교육비", "개인", "개인통장", "유출", 2000, "생활 이벤트", "일회", "가족 이벤트", "Y"],
    ["2026-06", "일회", "증여실행금액", "개인", "CMA", "유출", 200000, "증여", "일회", "세무 전문가 확인 필요", "Y"],
    ["2026-09", "일회", "증여세예상액", "개인", "CMA", "유출", 32000, "세금", "일회", "상담용 추정", "Y"],
    ["2026-12", "일회", "부동산양도세예상액", "개인", "증권계좌", "유출", 45000, "세금", "일회", "상담용 추정", "Y"],
  ];
}

function periodRowsFor(config) {
  const corporate = config.key === "corporate" || config.key === "linked_corporate_rep";
  const sole = config.key === "sole_proprietor";
  const baseIncome = corporate ? 46000 : sole ? 18000 : 4200;
  const baseOutflow = corporate ? 21000 : sole ? 9800 : 1700;
  const baseSaving = corporate ? 13000 : sole ? 4000 : 2600;
  const taxEvents = {
    "2026-03": corporate ? 85000 : 0,
    "2026-05": sole ? 14500 : 5200,
    "2026-07": sole ? 4800 : 900,
    "2026-08": 120000,
    "2026-09": 32000,
    "2026-12": corporate ? 12000 : 6500,
  };
  const taxMemo = {
    "2026-03": "법인세 납부월 - 현금화 재원 확인",
    "2026-05": sole ? "종합소득세 납부월 - 개인/사업자 통장 구분" : "종합소득세 납부월 - 현금화 재원 확인",
    "2026-07": sole ? "부가세 납부월 - 사업자 현금 잔액 확인" : "재산세 납부월 - 현금화 재원 확인",
    "2026-08": "상속세 납부월 - 현금화 재원 확인",
    "2026-09": "증여세 납부월 - 증여 실행 원금과 분리",
    "2026-12": corporate ? "법인 세금 예비월 - 단기 운용자금 확인" : "종부세 납부월 - 현금화 재원 확인",
  };
  return Array.from({ length: 12 }, (_, index) => {
    const month = String(index + 1).padStart(2, "0");
    const period = `2026-${month}`;
    const seasonalIncome = index === 3 ? 35000 : index === 11 ? 6000 : 0;
    const seasonalOutflow = index === 2 ? 2000 : index === 7 ? 1500 : 0;
    const giftExecutionOutflow = period === "2026-06" ? 200000 : 0;
    return {
      period,
      income: baseIncome + seasonalIncome,
      outflow: baseOutflow + seasonalOutflow + giftExecutionOutflow,
      saving: index % 3 === 0 ? baseSaving + 2000 : baseSaving,
      tax: taxEvents[period] ?? 0,
      memo:
        taxEvents[period] > 0
          ? taxMemo[period]
          : giftExecutionOutflow > 0
            ? "증여 실행 원금 유출월 - 증여세는 2026-09 반영"
          : index === 3
            ? "배당/상여 유입월"
            : "정상 월간 현금흐름",
      app: "Y",
    };
  });
}

function simpleMonthlyRows() {
  const monthlyBase = [
    { period: "2026-01", income: 89000, outflow: 146000, tax: 5700, memo: "정상 월간 현금흐름" },
    { period: "2026-02", income: 89000, outflow: 146000, tax: 5700, memo: "정상 월간 현금흐름" },
    { period: "2026-03", income: 89000, outflow: 146000, tax: 126000, memo: "법인세/종합소득세 등 납부월 예시" },
    { period: "2026-04", income: 139000, outflow: 146000, tax: 21000, memo: "배당·상여 유입월 예시" },
    { period: "2026-05", income: 89000, outflow: 146000, tax: 5700, memo: "종합소득세 납부 전 현금화 점검" },
    { period: "2026-06", income: 89000, outflow: 346000, tax: 5700, memo: "증여 실행·목적자금 유출월 예시" },
    { period: "2026-07", income: 89000, outflow: 146000, tax: 5700, memo: "재산세 납부월 예시" },
    { period: "2026-08", income: 89000, outflow: 161000, tax: 5700, memo: "교육비/휴가비 등 계절성 지출" },
    { period: "2026-09", income: 89000, outflow: 146000, tax: 32000, memo: "증여세 납부월 예시" },
    { period: "2026-10", income: 89000, outflow: 146000, tax: 5700, memo: "정상 월간 현금흐름" },
    { period: "2026-11", income: 89000, outflow: 146000, tax: 5700, memo: "부동산 양도세 현금화 준비월" },
    { period: "2026-12", income: 95000, outflow: 146000, tax: 65000, memo: "종부세/연말 세금 납부월 예시" },
  ];

  return monthlyBase.map((row) => ({
    ...row,
    net: row.income - row.outflow - row.tax,
    app: "Y",
  }));
}

async function buildSimpleMonthlyTemplate() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "samsung-youngcreator-PB";
  workbook.created = new Date();

  const ws = workbook.addWorksheet("월별_간소화_현금흐름", { views: [{ state: "frozen", ySplit: 5 }] });
  ws.columns = [
    { width: 16 },
    { width: 16 },
    { width: 22 },
    { width: 16 },
    { width: 18 },
    { width: 34 },
    { width: 12 },
  ];

  ws.mergeCells("A1:G1");
  ws.getCell("A1").value = "월별 간소화 현금흐름 업로드 양식";
  ws.getCell("A1").font = { bold: true, size: 18, color: { argb: "FF111827" } };
  ws.getCell("A1").alignment = { horizontal: "center" };
  ws.mergeCells("A2:G2");
  ws.getCell("A2").value =
    "세부항목을 적지 않고 월별 순유입, 순유출(세금 제외), 총세금만 입력합니다. 금액 단위는 만원입니다.";
  ws.getCell("A2").font = { size: 10, color: { argb: "FF4B5563" } };
  ws.getCell("A2").alignment = { horizontal: "center", wrapText: true };

  ws.mergeCells("A3:G3");
  ws.getCell("A3").value =
    "순유출에는 세금을 넣지 마세요. 세금은 반드시 총세금 컬럼에 따로 입력해야 앱 차트와 세후 결과가 맞습니다.";
  ws.getCell("A3").font = { bold: true, color: { argb: "FFB91C1C" } };
  ws.getCell("A3").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE4E6" } };
  ws.getCell("A3").alignment = { horizontal: "center", wrapText: true };

  const header = ws.getRow(5);
  header.values = [
    "기간(YYYY-MM)",
    "순유입(만원)",
    "순유출(세금 제외)(만원)",
    "총세금(만원)",
    "월 순자금(만원)",
    "메모",
    "앱 반영(Y/N)",
  ];
  styleHeader(header);

  let cumulative = 0;
  simpleMonthlyRows().forEach((item, index) => {
    const rowNumber = 6 + index;
    cumulative += item.net;
    const row = ws.getRow(rowNumber);
    row.values = [
      item.period,
      item.income,
      item.outflow,
      item.tax,
      {
        formula: `B${rowNumber}-C${rowNumber}-D${rowNumber}`,
        result: item.net,
      },
      item.memo,
      item.app,
    ];
    styleInputRow(row, [1, 2, 3, 4, 6, 7]);
    row.getCell(5).font = { color: { argb: item.net < 0 ? "FFB91C1C" : "FF1428A0" }, bold: true };
    row.getCell(5).border = border;
  });

  for (let column = 2; column <= 5; column += 1) ws.getColumn(column).numFmt = "#,##0";

  ws.getCell("A20").value = "작성 예시";
  ws.getCell("A20").font = { bold: true };
  ws.getCell("B20").value =
    "예: 2026-05 순유입 8,900 / 순유출 14,600 / 총세금 5,700이면 앱에는 순유입 8.9억, 순유출 14.6억, 총세금 5,700만으로 표시됩니다.";
  ws.getCell("B20").alignment = { wrapText: true };
  ws.mergeCells("B20:G20");
  ws.getRow(20).eachCell((cell) => {
    cell.border = border;
    cell.fill = mutedFill;
  });

  const guideWs = workbook.addWorksheet("작성가이드");
  guideWs.columns = [{ width: 28 }, { width: 92 }];
  styleHeader(guideWs.addRow(["구분", "가이드"]));
  [
    ["목적", "PB 상담 화면의 월별 간소화 현금흐름 차트와 표에 바로 반영하기 위한 업로드 양식입니다."],
    ["필수 입력", "기간(YYYY-MM), 순유입, 순유출(세금 제외), 총세금, 앱 반영(Y/N)을 입력합니다."],
    ["순유입", "급여, 매출, 배당, 임대수입, 상여금처럼 해당 월에 들어오는 현금 총액입니다."],
    ["순유출", "생활비, 사업비용, 교육비, 증여 실행 원금, 목적자금 지출 등 세금을 제외한 유출 총액입니다."],
    ["총세금", "종합소득세, 종부세, 재산세, 법인세, 양도소득세, 증여세 등 해당 월 납부 세금 총액입니다."],
    ["주의", "순유출에 세금을 포함하면 앱에서 세금이 중복 계산될 수 있습니다."],
    ["업로드", "현금흐름 화면의 '월별 현금흐름 파일 첨부' 영역에 이 XLSX 파일을 첨부하면 됩니다."],
  ].forEach((values) => {
    const added = guideWs.addRow(values);
    styleInputRow(added, []);
  });

  const filePath = path.join(outputDir, "monthly-cashflow-simple.xlsx");
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

function addPeriodAppendixSheet(workbook, config) {
  const ws = workbook.addWorksheet("부록_기간별현금흐름", { views: [{ state: "frozen", ySplit: 4 }] });
  ws.columns = [
    { width: 16 },
    { width: 14 },
    { width: 14 },
    { width: 16 },
    { width: 14 },
    { width: 18 },
    { width: 20 },
    { width: 34 },
    { width: 12 },
  ];

  ws.mergeCells("A1:I1");
  ws.getCell("A1").value = "부록 · 기간별 현금흐름";
  ws.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF111827" } };
  ws.getCell("A1").alignment = { horizontal: "center" };
  ws.mergeCells("A2:I2");
  ws.getCell("A2").value =
    "월별 유입·유출·저축/투자·세금 납부액을 입력하면 앱의 현금흐름 부록과 IPS 부록 표/차트에 반영됩니다. 금액 단위는 만원입니다.";
  ws.getCell("A2").font = { size: 10, color: { argb: "FF4B5563" } };
  ws.getCell("A2").alignment = { horizontal: "center", wrapText: true };

  const header = ws.getRow(4);
  header.values = [
    "기간(YYYY-MM)",
    "유입(만원)",
    "유출(만원)",
    "저축/투자(만원)",
    "세금납부(만원)",
    "순현금흐름(만원)",
    "누적순현금흐름(만원)",
    "주요 이벤트/메모",
    "앱 반영(Y/N)",
  ];
  styleHeader(header);

  periodRowsFor(config).forEach((item, index) => {
    const rowNumber = 5 + index;
    const row = ws.getRow(rowNumber);
    row.values = [
      item.period,
      item.income,
      item.outflow,
      item.saving,
      item.tax,
      { formula: `B${rowNumber}-C${rowNumber}-D${rowNumber}-E${rowNumber}`, result: item.income - item.outflow - item.saving - item.tax },
      {
        formula: rowNumber === 5 ? `F${rowNumber}` : `G${rowNumber - 1}+F${rowNumber}`,
        result: periodRowsFor(config)
          .slice(0, index + 1)
          .reduce((sum, point) => sum + point.income - point.outflow - point.saving - point.tax, 0),
      },
      item.memo,
      item.app,
    ];
    styleInputRow(row, [1, 2, 3, 4, 5, 8, 9]);
  });

  for (let column = 2; column <= 7; column += 1) ws.getColumn(column).numFmt = "#,##0";
  ws.getCell("A19").value = "작성 원칙";
  ws.getCell("A19").font = { bold: true };
  ws.getCell("B19").value =
    "앱은 앱 반영(Y/N)이 Y인 행만 읽습니다. 세금/회계 확정 판단이 아니라 상담용 추정이며 세무 전문가 확인이 필요합니다.";
  ws.getCell("B19").alignment = { wrapText: true };
  ws.getRow(19).eachCell((cell) => {
    cell.border = border;
    cell.fill = mutedFill;
  });
}

async function buildWorkbook(config) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "samsung-youngcreator-PB";
  workbook.created = new Date();

  const ws = workbook.addWorksheet("현금흐름표", { views: [{ state: "frozen", ySplit: 3 }] });
  ws.columns = [
    { width: 18 }, { width: 18 }, { width: 24 }, { width: 16 }, { width: 16 }, { width: 12 },
    { width: 16 }, { width: 20 }, { width: 14 }, { width: 30 }, { width: 12 },
  ];
  setTitle(ws, config.title, config.purpose);

  let row = 4;
  row = section(ws, row, "1. 고객 기본정보");
  row = addKeyValueBlock(ws, row, [
    ["고객명", "", "필수"],
    ["고객 유형", config.subject, "개인/법인/개인사업자/법인-대표 연동"],
    ["담당 PB", "", "PB명"],
    ["작성 기준일", "2026-06-21", "YYYY-MM-DD"],
    ["총 금융자산(만원)", "", "상담 입력값"],
    ["연동 고객 ID", "", "법인↔대표 연결 시 입력"],
    ["지분율(%)", "", "법인 대표/최대주주 확인"],
    ["통장 분리 여부", config.key === "sole_proprietor" ? "혼용" : "해당없음", config.accountNote],
  ]);

  row += 1;
  row = section(ws, row, "2. 재무목표");
  row = addTable(ws, row, ["목표명", "목표시점", "목표금액(만원)", "우선순위", "메모"], [
    ["세금 납부 재원 확보", "2026-09", 32000, "상", "증여세/양도세 납부 전 현금화"],
    ["자녀 증여 실행", "2026-06", 200000, "상", "증여세 별도 예치"],
    ["은퇴 현금흐름", "2031-12", 500000, "중", "월 인출 계획"],
    ["법인 운전자금 방어", "2026-12", 100000, config.key === "corporate" ? "상" : "중", "법인 고객만 상세 입력"],
  ], [2, 3, 4, 5]);

  row += 1;
  row = section(ws, row, "3. 현재 현금흐름");
  row = addTable(ws, row, [
    "일자(YYYY-MM)", "정기/일회", "항목명", "자금주체", "계좌유형", "유입/유출", "금액(만원)",
    "세무·회계 성격", "반복주기", "메모", "앱 반영(Y/N)",
  ], mainCashflowRows(config), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

  row += 1;
  row = section(ws, row, "4. 고액자산가 세금 납부 및 현금화 일정");
  row = addTable(ws, row, ["세금/이벤트", "기준일", "예상세액(만원)", "납부기한", "현금화 목표일", "준비상태", "메모"], [
    ["증여세", "2026-06-30", 32000, "2026-09-30", "2026-06-30", "점검", "증여일 기준 3개월 이내"],
    ["상속세", "2026-02-28", 120000, "2026-08-31", "2026-07-31", "부족", "상담용 추정"],
    ["부동산 양도세", "2026-10-31", 45000, "2026-12-31", "2026-11-30", "점검", "양도월 말일부터 2개월 이내"],
    ["해외주식 양도세", "2026", 8000, "2027-05-31", "2027-04-30", "커버", "다음해 5월 신고"],
    ["법인세", "2026-12-31", config.key === "corporate" || config.key === "linked_corporate_rep" ? 85000 : 0, "2027-03-31", "2027-02-28", "점검", "법인 고객"],
  ], [1, 2, 3, 4, 5, 6, 7]);

  row += 1;
  row = section(ws, row, "5. 현재 보유자산 및 부채");
  row = addTable(ws, row, ["구분", "항목", "금액(만원)", "계좌/자산 위치", "메모"], [
    ["현금성", "현재현금성자산", 90000, "CMA/MMF", "앱 업로드 시 현재 현금으로 인식"],
    ["금융투자", "국내주식", 120000, "증권계좌", "평가손익 별도"],
    ["금융투자", "해외주식", 180000, "증권계좌", "해외주식 양도세 점검"],
    ["부동산", "상가/주택", 700000, "실물자산", "양도세/보유세 별도"],
    ["부채", "대출잔액", 150000, "담보대출", "상환 스케줄 별도"],
  ], [1, 2, 3, 4, 5]);

  row += 1;
  row = section(ws, row, "6. 입력 팁/작성 원칙");
  row = addKeyValueBlock(ws, row, [
    ["입력 단위", "만원", "업로드용_키값 시트도 값(만원) 기준"],
    ["세무 판단", "상담용 추정", "세무·회계 확정 판단 금지, 전문가 확인 필요"],
    ["중복 방지", config.key === "linked_corporate_rep" ? "법인 배당 지급과 개인 배당 유입 기준월을 맞춰 메모" : "동일 이벤트 중복 입력 금지", ""],
    ["앱 업로드", "업로드용_키값 시트를 CSV/XLSX로 저장하거나 전체 XLSX 업로드", ""],
  ]);

  ws.eachRow((excelRow) => {
    excelRow.height = Math.max(18, excelRow.height ?? 18);
  });

  const uploadWs = workbook.addWorksheet("업로드용_키값", { views: [{ state: "frozen", ySplit: 1 }] });
  uploadWs.columns = [{ width: 28 }, { width: 16 }, { width: 16 }, { width: 16 }];
  const uploadHeader = uploadWs.addRow(["항목", "값(만원)", "납부일", "분류"]);
  styleHeader(uploadHeader);
  uploadRowsFor(config.key).forEach((values) => {
    const added = uploadWs.addRow(values);
    styleInputRow(added, [1, 2, 3, 4]);
  });
  uploadWs.getColumn(2).numFmt = "#,##0";

  addPeriodAppendixSheet(workbook, config);

  const guideWs = workbook.addWorksheet("작성가이드");
  guideWs.columns = [{ width: 28 }, { width: 82 }];
  styleHeader(guideWs.addRow(["구분", "가이드"]));
  [
    ["목적", config.purpose],
    ["작성 순서", "고객 기본정보 → 재무목표 → 현재 현금흐름 → 세금 납부 일정 → 보유자산/부채 → 업로드용_키값 확인"],
    ["업로드 규칙", "앱은 업로드용_키값 시트를 우선 읽고, 부록_기간별현금흐름 시트를 함께 읽어 현금흐름/IPS 부록 표와 차트에 반영합니다."],
    ["앱 CashFlow 매핑", "항목→label, 값(만원)→amount, 납부일→date, 분류→category, 자금주체→entity, 계좌유형→accountType, 메모→taxAccountingNote"],
    ["기간별 부록 매핑", "기간→date, 유입/유출/저축/세금→amount, 주요 이벤트/메모→taxAccountingNote, 앱 반영(Y/N)→업로드 포함 여부"],
    ["세무·회계 유의", "본 양식은 PB 상담 보조용 추정 자료입니다. 실제 세액, 신고기한, 비용처리, 법인/개인 자금 이동은 세무 전문가 확인이 필요합니다."],
    ["법인-대표 연동", "법인 배당 지급과 대표 개인 배당 유입은 양쪽에 입력하되 앱 반영/메모로 중복 여부를 확인합니다."],
  ].forEach((values) => {
    const added = guideWs.addRow(values);
    styleInputRow(added, []);
  });

  const filePath = path.join(outputDir, config.file);
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

await mkdir(outputDir, { recursive: true });
const simpleFilePath = await buildSimpleMonthlyTemplate();
console.log(`generated ${path.relative(repoRoot, simpleFilePath)}`);
if (!process.argv.includes("--simple-only")) {
  for (const config of configs) {
    const filePath = await buildWorkbook(config);
    console.log(`generated ${path.relative(repoRoot, filePath)}`);
  }
}
