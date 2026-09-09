# Customer IPS Design

The customer-facing IPS is a print document, not an application dashboard.
Its original layout uses the site's Samsung Securities blue, white paper,
restrained rules, and tabular numbers. Screen and print share the same styles
in `app/ips-document.css`.

## References

- [Morningstar IPS worksheet](https://video.morningstar.com/ca/InvestmentPolicyStatement-ENG.pdf):
  a two-page structure separating investment goals/allocation from implementation
  and review. This informed the document hierarchy, not a copied visual template.
- [CFA Institute: Elements of an IPS for Individual Investors](https://rpc.cfainstitute.org/policy/positions/elements-of-an-investment-policy-statement-for-individual-investors):
  investment objectives, constraints, and portfolio governance. No new review
  commitments, return promises, or client facts are invented.

## Document Structure

1. Client and PB, investable assets, the seven existing investment-policy factors,
   and the approved asset allocation.
2. Approved instruments, available return/risk and tax estimates, all existing
   warnings, and acknowledgement/signature fields.

Cash-flow sections and their appendices are removed from the document only.
Cash-flow records, tax calculations, and approval controls elsewhere are retained.
Percentages display one decimal place without changing stored values. Instrument
amounts use an explicitly labelled KRW 10,000 unit. Unavailable values are not
represented as zero. Tax estimates require matching portfolio weights; the old
hardcoded fallback allocation must not be used for an unrelated custom portfolio.

The standard four-instrument fixture occupies two A4 pages. More instruments
produce continuation sheets, reserving four rows on the final sheet for warnings
and signatures. No instruments or customer-entered policy text are truncated.
Unusually long free text can naturally extend a printed sheet; recheck print
preview for such documents. Approval and final-document access gates are unchanged.

## Verification

`npm test` includes `lib/ipsDocument.test.tsx` for content, pagination, missing
data, warning preservation, and non-mutation of the supplied customer snapshot.

Generate isolated proofs using fictional data only:

```sh
npx --yes tsx scripts/render-ips-proof.tsx /tmp/ips-design-proof
node scripts/verify-ips-layout.mjs /tmp/ips-design-proof
```

The verification script needs Playwright, a Chromium installation, and `pdfinfo`
(Poppler). Existing installations can be selected with `PLAYWRIGHT_MODULE` and
`CHROMIUM_EXECUTABLE`; the app itself does not depend on these QA tools.
It verifies 2/3/4 actual PDF pages for 4/8/19 instruments, two pages with the
optional tax summary, A4 dimensions, and no horizontal overflow at 390px.
It also generates screenshots for visual review.
Proof HTML/PDF files belong outside Git and must never contain real customer data.
