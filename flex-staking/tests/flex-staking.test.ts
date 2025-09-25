
import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const validator1 = accounts.get("wallet_3")!;
const validator2 = accounts.get("wallet_4")!;

const contractName = "flex-staking";

describe("FlexStaking Contract - Basic Setup and Initialization", () => {
  beforeEach(() => {
    // Reset simnet state before each test
    simnet.setEpoch("3.0");
  });

  describe("Contract Initialization", () => {
    it("initializes with correct default values", () => {
      const { result: totalStaked } = simnet.callReadOnlyFn(
        contractName,
        "get-protocol-stats",
        [],
        deployer
      );
      
      expect(totalStaked).toBeOk(
        Cl.tuple({
          "total-staked": Cl.uint(0),
          "total-liquid-tokens": Cl.uint(0),
          "exchange-rate": Cl.uint(1000000),
          "protocol-fees": Cl.uint(0),
          "current-cycle": Cl.uint(0)
        })
      );
    });

    it("sets contract owner correctly", () => {
      // Try to call owner-only function with non-owner account
      const { result } = simnet.callPublicFn(
        contractName,
        "toggle-contract-pause",
        [],
        wallet1
      );
      
      expect(result).toBeErr(Cl.uint(100)); // err-owner-only
    });

    it("allows owner to pause/unpause contract", () => {
      const { result: pauseResult } = simnet.callPublicFn(
        contractName,
        "toggle-contract-pause",
        [],
        deployer
      );
      
      expect(pauseResult).toBeOk(Cl.bool(true));
      
      // Verify contract is paused by trying to stake
      const { result: stakeResult } = simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(500)], // 5% commission
        validator1
      );
      
      expect(stakeResult).toBeErr(Cl.uint(101)); // err-not-authorized
    });
  });

  describe("Validator Registration", () => {
    it("allows validator registration with valid commission", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(500)], // 5% commission
        validator1
      );
      
      expect(result).toBeOk(Cl.bool(true));
      
      // Verify validator was registered
      const { result: pool } = simnet.callReadOnlyFn(
        contractName,
        "get-staking-pool",
        [Cl.principal(validator1)],
        deployer
      );
      
      expect(pool).toBeSome(
        Cl.tuple({
          "total-delegated": Cl.uint(0),
          "liquid-tokens-issued": Cl.uint(0),
          "active": Cl.bool(true),
          "commission-rate": Cl.uint(500),
          "validator-rewards": Cl.uint(0),
          "last-reward-cycle": Cl.uint(0)
        })
      );
    });

    it("rejects validator registration with excessive commission", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(2500)], // 25% commission (over 20% limit)
        validator1
      );
      
      expect(result).toBeErr(Cl.uint(103)); // err-invalid-amount
    });

    it("prevents duplicate validator registration", () => {
      // Register validator first time
      simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(500)],
        validator1
      );
      
      // Try to register again
      const { result } = simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(1000)],
        validator1
      );
      
      expect(result).toBeErr(Cl.uint(105)); // err-already-staking
    });

    it("allows validator to update commission rate", () => {
      // Register validator first
      simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(500)],
        validator1
      );
      
      // Update commission rate
      const { result } = simnet.callPublicFn(
        contractName,
        "update-validator-commission",
        [Cl.uint(750)], // 7.5% commission
        validator1
      );
      
      expect(result).toBeOk(Cl.bool(true));
      
      // Verify commission was updated
      const { result: pool } = simnet.callReadOnlyFn(
        contractName,
        "get-staking-pool",
        [Cl.principal(validator1)],
        deployer
      );
      
      const poolData = pool as any;
      expect(poolData.value.data["commission-rate"]).toBeUint(750);
    });

    it("allows validator deactivation", () => {
      // Register validator first
      simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(500)],
        validator1
      );
      
      // Deactivate validator
      const { result } = simnet.callPublicFn(
        contractName,
        "deactivate-validator",
        [],
        validator1
      );
      
      expect(result).toBeOk(Cl.bool(true));
      
      // Verify validator is deactivated
      const { result: pool } = simnet.callReadOnlyFn(
        contractName,
        "get-staking-pool",
        [Cl.principal(validator1)],
        deployer
      );
      
      const poolData = pool as any;
      expect(poolData.value.data.active).toBeBool(false);
    });
  });

  describe("Read-only Functions", () => {
    it("returns correct liquid token calculations", () => {
      const { result: liquidTokens } = simnet.callReadOnlyFn(
        contractName,
        "calculate-liquid-tokens",
        [Cl.uint(1000000)], // 1 STX
        deployer
      );
      
      expect(liquidTokens).toBeUint(1000000); // 1:1 initially
      
      const { result: stxValue } = simnet.callReadOnlyFn(
        contractName,
        "calculate-stx-value",
        [Cl.uint(1000000)], // 1 liquid token
        deployer
      );
      
      expect(stxValue).toBeUint(1000000); // 1:1 initially
    });

    it("returns empty user stake for non-staking user", () => {
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "get-user-stake",
        [Cl.principal(wallet1), Cl.principal(validator1)],
        deployer
      );
      
      expect(result).toBeNone();
    });

    it("returns zero liquid token balance for new user", () => {
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "get-liquid-token-balance",
        [Cl.principal(wallet1)],
        deployer
      );
      
      expect(result).toBeTuple({
        balance: Cl.uint(0),
        "last-claim-cycle": Cl.uint(0)
      });
    });
  });

  describe("Administrative Functions", () => {
    it("allows owner to update current cycle", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "update-current-cycle",
        [Cl.uint(5)],
        deployer
      );
      
      expect(result).toBeOk(Cl.bool(true));
      
      // Verify cycle was updated
      const { result: stats } = simnet.callReadOnlyFn(
        contractName,
        "get-protocol-stats",
        [],
        deployer
      );
      
      const statsData = stats as any;
      expect(statsData.value.data["current-cycle"]).toBeUint(5);
    });

    it("rejects non-owner administrative calls", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "update-current-cycle",
        [Cl.uint(5)],
        wallet1
      );
      
      expect(result).toBeErr(Cl.uint(100)); // err-owner-only
    });
  });
});
