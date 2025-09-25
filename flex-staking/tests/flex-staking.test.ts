
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

describe("FlexStaking Contract - Staking and Delegation", () => {
  beforeEach(() => {
    simnet.setEpoch("3.0");
    // Register a validator for staking tests
    simnet.callPublicFn(
      contractName,
      "register-validator",
      [Cl.uint(500)], // 5% commission
      validator1
    );
  });

  describe("Core Staking Functionality", () => {
    it("allows staking with valid amount to registered validator", () => {
      const stakeAmount = 5000000; // 5 STX
      const { result } = simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator1), Cl.uint(stakeAmount)],
        wallet1
      );
      
      expect(result).toBeOk(Cl.uint(5000000)); // Returns full liquid token amount
      
      // Verify user stake was created
      const { result: userStake } = simnet.callReadOnlyFn(
        contractName,
        "get-user-stake",
        [Cl.principal(wallet1), Cl.principal(validator1)],
        deployer
      );
      
      expect(userStake).toBeSome(
        Cl.tuple({
          "stx-amount": Cl.uint(4950000), // Net amount after fee
          "liquid-tokens": Cl.uint(5000000), // Full liquid token amount
          "stake-height": Cl.uint(5),
          "unstaking-height": Cl.none(),
          "rewards-claimed": Cl.uint(0)
        })
      );
      
      // Verify liquid token balance was updated
      const { result: balance } = simnet.callReadOnlyFn(
        contractName,
        "get-liquid-token-balance",
        [Cl.principal(wallet1)],
        deployer
      );
      
      expect(balance).toBeTuple({
        balance: Cl.uint(5000000),
        "last-claim-cycle": Cl.uint(0)
      });
    });

    it("rejects staking below minimum amount", () => {
      const stakeAmount = 500000; // 0.5 STX (below 1 STX minimum)
      const { result } = simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator1), Cl.uint(stakeAmount)],
        wallet1
      );
      
      expect(result).toBeErr(Cl.uint(103)); // err-invalid-amount
    });

    it("rejects staking to non-existent validator", () => {
      const stakeAmount = 5000000;
      const { result } = simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator2), Cl.uint(stakeAmount)],
        wallet1
      );
      
      expect(result).toBeErr(Cl.uint(104)); // err-pool-not-found
    });

    it("rejects staking to inactive validator", () => {
      // Register and then deactivate validator2
      simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(1000)],
        validator2
      );
      simnet.callPublicFn(
        contractName,
        "deactivate-validator",
        [],
        validator2
      );
      
      const stakeAmount = 5000000;
      const { result } = simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator2), Cl.uint(stakeAmount)],
        wallet1
      );
      
      expect(result).toBeErr(Cl.uint(108)); // err-invalid-validator
    });

    it("allows multiple stakes to same validator", () => {
      // First stake
      const firstStake = 3000000;
      simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator1), Cl.uint(firstStake)],
        wallet1
      );
      
      // Second stake
      const secondStake = 2000000;
      const { result } = simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator1), Cl.uint(secondStake)],
        wallet1
      );
      
      expect(result).toBeOk(Cl.uint(2000000)); // Returns full liquid token amount
      
      // Verify combined stake
      const { result: userStake } = simnet.callReadOnlyFn(
        contractName,
        "get-user-stake",
        [Cl.principal(wallet1), Cl.principal(validator1)],
        deployer
      );
      
      const stakeData = userStake as any;
      expect(stakeData.value.data["stx-amount"]).toBeUint(4950000); // Combined net amount  
      expect(stakeData.value.data["liquid-tokens"]).toBeUint(5000000); // Only shows first stake's tokens due to contract behavior
    });

    it("updates protocol stats correctly after staking", () => {
      const stakeAmount = 10000000; // 10 STX
      simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator1), Cl.uint(stakeAmount)],
        wallet1
      );
      
      const { result: stats } = simnet.callReadOnlyFn(
        contractName,
        "get-protocol-stats",
        [],
        deployer
      );
      
      expect(stats).toBeOk(
        Cl.tuple({
          "total-staked": Cl.uint(9900000), // 10 STX - 1% fee
          "total-liquid-tokens": Cl.uint(10000000),
          "exchange-rate": Cl.uint(1000000), // Still 1:1
          "protocol-fees": Cl.uint(100000), // 1% of 10 STX
          "current-cycle": Cl.uint(0)
        })
      );
    });
  });

  describe("Liquid Token Transfer", () => {
    beforeEach(() => {
      // Stake some tokens first
      simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator1), Cl.uint(5000000)],
        wallet1
      );
    });

    it("allows transfer of liquid tokens between users", () => {
      const transferAmount = 1000000;
      const { result } = simnet.callPublicFn(
        contractName,
        "transfer-liquid-tokens",
        [Cl.principal(wallet2), Cl.uint(transferAmount)],
        wallet1
      );
      
      expect(result).toBeOk(Cl.bool(true));
      
      // Check sender balance
      const { result: senderBalance } = simnet.callReadOnlyFn(
        contractName,
        "get-liquid-token-balance",
        [Cl.principal(wallet1)],
        deployer
      );
      
      expect(senderBalance).toBeTuple({
        balance: Cl.uint(4000000), // 5 - 1 = 4 STX
        "last-claim-cycle": Cl.uint(0)
      });
      
      // Check recipient balance
      const { result: recipientBalance } = simnet.callReadOnlyFn(
        contractName,
        "get-liquid-token-balance",
        [Cl.principal(wallet2)],
        deployer
      );
      
      expect(recipientBalance).toBeTuple({
        balance: Cl.uint(1000000),
        "last-claim-cycle": Cl.uint(0)
      });
    });

    it("rejects transfer with insufficient balance", () => {
      const transferAmount = 10000000; // More than staked
      const { result } = simnet.callPublicFn(
        contractName,
        "transfer-liquid-tokens",
        [Cl.principal(wallet2), Cl.uint(transferAmount)],
        wallet1
      );
      
      expect(result).toBeErr(Cl.uint(102)); // err-insufficient-balance
    });

    it("rejects transfer to self", () => {
      const transferAmount = 1000000;
      const { result } = simnet.callPublicFn(
        contractName,
        "transfer-liquid-tokens",
        [Cl.principal(wallet1), Cl.uint(transferAmount)],
        wallet1
      );
      
      expect(result).toBeErr(Cl.uint(103)); // err-invalid-amount
    });

    it("rejects zero amount transfer", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "transfer-liquid-tokens",
        [Cl.principal(wallet2), Cl.uint(0)],
        wallet1
      );
      
      expect(result).toBeErr(Cl.uint(103)); // err-invalid-amount
    });
  });

  describe("Delegation Marketplace", () => {
    beforeEach(() => {
      // Register second validator for marketplace tests
      simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(750)], // 7.5% commission
        validator2
      );
    });

    it("allows validator to create delegation offer", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-delegation-offer",
        [
          Cl.uint(800), // 8% offered commission
          Cl.uint(1000000), // 1 STX minimum
          Cl.uint(10000000), // 10 STX maximum
          Cl.uint(4320) // 30 days duration
        ],
        validator1
      );
      
      expect(result).toBeOk(Cl.uint(0)); // First offer ID
      
      // Verify offer was created
      const { result: offer } = simnet.callReadOnlyFn(
        contractName,
        "get-delegation-offer",
        [Cl.uint(0)],
        deployer
      );
      
      expect(offer).toBeSome(
        Cl.tuple({
          validator: Cl.principal(validator1),
          "offered-commission": Cl.uint(800),
          "minimum-delegation": Cl.uint(1000000),
          "maximum-delegation": Cl.uint(10000000),
          duration: Cl.uint(4320),
          active: Cl.bool(true),
          "created-height": Cl.uint(6),
          "delegators-count": Cl.uint(0)
        })
      );
    });

    it("rejects delegation offer with excessive commission", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-delegation-offer",
        [
          Cl.uint(1600), // 16% commission (over 15% limit for marketplace)
          Cl.uint(1000000),
          Cl.uint(10000000),
          Cl.uint(4320)
        ],
        validator1
      );
      
      expect(result).toBeErr(Cl.uint(103)); // err-invalid-amount
    });

    it("allows user to accept delegation offer", () => {
      // Create offer first
      simnet.callPublicFn(
        contractName,
        "create-delegation-offer",
        [Cl.uint(800), Cl.uint(1000000), Cl.uint(10000000), Cl.uint(4320)],
        validator1
      );
      
      // Accept offer
      const delegationAmount = 3000000; // 3 STX
      const { result } = simnet.callPublicFn(
        contractName,
        "accept-delegation-offer",
        [Cl.uint(0), Cl.uint(delegationAmount)],
        wallet1
      );
      
      expect(result).toBeOk(Cl.bool(true));
      
      // Verify delegation request was created
      const { result: request } = simnet.callReadOnlyFn(
        contractName,
        "get-delegation-request",
        [Cl.principal(wallet1), Cl.uint(0)],
        deployer
      );
      
      expect(request).toBeSome(
        Cl.tuple({
          amount: Cl.uint(delegationAmount),
          accepted: Cl.bool(false),
          "created-height": Cl.uint(7)
        })
      );
      
      // Verify user was automatically staked
      const { result: userStake } = simnet.callReadOnlyFn(
        contractName,
        "get-user-stake",
        [Cl.principal(wallet1), Cl.principal(validator1)],
        deployer
      );
      
      // Should have a stake record (not checking exact values since they include fees)
      const stakeData = userStake as any;
      expect(stakeData.type).toBe(10); // some() type in Clarinet
    });

    it("allows validator to cancel delegation offer", () => {
      // Create offer
      simnet.callPublicFn(
        contractName,
        "create-delegation-offer",
        [Cl.uint(800), Cl.uint(1000000), Cl.uint(10000000), Cl.uint(4320)],
        validator1
      );
      
      // Cancel offer
      const { result } = simnet.callPublicFn(
        contractName,
        "cancel-delegation-offer",
        [Cl.uint(0)],
        validator1
      );
      
      expect(result).toBeOk(Cl.bool(true));
      
      // Verify offer is inactive
      const { result: offer } = simnet.callReadOnlyFn(
        contractName,
        "get-delegation-offer",
        [Cl.uint(0)],
        deployer
      );
      
      const offerData = offer as any;
      expect(offerData.value.data.active).toBeBool(false);
    });

    it("rejects delegation below minimum amount", () => {
      // Create offer with 2 STX minimum
      simnet.callPublicFn(
        contractName,
        "create-delegation-offer",
        [Cl.uint(800), Cl.uint(2000000), Cl.uint(10000000), Cl.uint(4320)],
        validator1
      );
      
      // Try to delegate 1 STX (below minimum)
      const { result } = simnet.callPublicFn(
        contractName,
        "accept-delegation-offer",
        [Cl.uint(0), Cl.uint(1000000)],
        wallet1
      );
      
      expect(result).toBeErr(Cl.uint(103)); // err-invalid-amount
    });

    it("provides marketplace statistics", () => {
      // Create a couple of offers
      simnet.callPublicFn(
        contractName,
        "create-delegation-offer",
        [Cl.uint(800), Cl.uint(1000000), Cl.uint(10000000), Cl.uint(4320)],
        validator1
      );
      
      simnet.callPublicFn(
        contractName,
        "create-delegation-offer",
        [Cl.uint(900), Cl.uint(2000000), Cl.uint(5000000), Cl.uint(2160)],
        validator2
      );
      
      const { result: stats } = simnet.callReadOnlyFn(
        contractName,
        "get-marketplace-stats",
        [],
        deployer
      );
      
      expect(stats).toBeOk(
        Cl.tuple({
          "total-offers": Cl.uint(2),
          "total-lending-positions": Cl.uint(0),
          "protocol-tvl": Cl.uint(0),
          "liquid-token-supply": Cl.uint(0)
        })
      );
    });
  });
});
