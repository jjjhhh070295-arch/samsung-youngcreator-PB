export const microStressScenarios = {
  mild: {
    name: "Mild",
    revenueShock: -0.1,
    vacancyShockPp: 3,
    spreadShockBp: 50,
    fundingSpreadShockBp: 50,
    message: "관찰",
  },
  base: {
    name: "Base",
    revenueShock: -0.2,
    vacancyShockPp: 7,
    spreadShockBp: 100,
    fundingSpreadShockBp: 150,
    message: "주의",
  },
  severe: {
    name: "Severe",
    revenueShock: -0.35,
    vacancyShockPp: 12,
    spreadShockBp: 200,
    fundingSpreadShockBp: 250,
    message: "위험",
  },
};
