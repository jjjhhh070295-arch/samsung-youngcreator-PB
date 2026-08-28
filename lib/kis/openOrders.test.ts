import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildKisCancelBody, mapKisOpenOrders } from "./openOrders";

describe("KIS open orders", () => {
  it("maps only orders with cancelable quantity", () => {
    const rows = mapKisOpenOrders([
      {
        ord_gno_brno: "91258",
        odno: "001",
        pdno: "007660",
        prdt_name: "이수페타시스",
        sll_buy_dvsn_cd: "02",
        ord_qty: "4",
        tot_ccld_qty: "0",
        psbl_qty: "4",
        ord_unpr: "110700",
        ord_tmd: "105928",
        ord_dvsn_cd: "00",
        ord_dvsn_name: "지정가",
        excg_id_dvsn_cd: "SOR",
      },
      { ord_gno_brno: "1", odno: "002", psbl_qty: "0" },
    ]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.cancelableQty, 4);
    assert.equal(rows[0]?.side, "buy");
    assert.equal(rows[0]?.exchange, "SOR");
  });

  it("builds an all-remaining cancel body from authoritative KIS fields", () => {
    const [order] = mapKisOpenOrders([
      {
        ord_gno_brno: "91258",
        odno: "001",
        pdno: "007660",
        psbl_qty: "4",
        ord_qty: "4",
        ord_unpr: "110700",
        ord_dvsn_cd: "00",
        excg_id_dvsn_cd: "SOR",
      },
    ]);
    assert.ok(order);
    assert.deepEqual(buildKisCancelBody(order), {
      KRX_FWDG_ORD_ORGNO: "91258",
      ORGN_ODNO: "001",
      ORD_DVSN: "00",
      RVSE_CNCL_DVSN_CD: "02",
      ORD_QTY: "0",
      ORD_UNPR: "0",
      QTY_ALL_ORD_YN: "Y",
      EXCG_ID_DVSN_CD: "SOR",
    });
  });
});
