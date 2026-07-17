const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ZK-Dark Pool DEX", function () {
  let verifier, darkPool, mbtc, musdc;
  let owner, buyer, seller;
  let decimals = 18;

  beforeEach(async function () {
    [owner, buyer, seller] = await ethers.getSigners();

    // 1. Deploy mock verifier
    const Verifier = await ethers.getContractFactory("Verifier");
    verifier = await Verifier.deploy();

    // 2. Deploy DarkPool
    const DarkPool = await ethers.getContractFactory("DarkPool");
    darkPool = await DarkPool.deploy(await verifier.getAddress());

    // 3. Deploy mock ERC20 tokens
    const MockToken = await ethers.getContractFactory("MockToken");
    mbtc = await MockToken.deploy("Mock Bitcoin", "MBTC");
    musdc = await MockToken.deploy("Mock USD Coin", "MUSDC");

    // 4. Distribute tokens
    await mbtc.mint(seller.address, ethers.parseUnits("10", decimals));
    await musdc.mint(buyer.address, ethers.parseUnits("500000", decimals)); // 500k USDC
  });

  describe("Deposits & Withdrawals", function () {
    it("Should allow deposit and track internal balance", async function () {
      const depositAmount = ethers.parseUnits("5", decimals);

      // Approve & Deposit base token (MBTC) for Seller
      await mbtc.connect(seller).approve(await darkPool.getAddress(), depositAmount);
      await expect(darkPool.connect(seller).deposit(await mbtc.getAddress(), depositAmount))
        .to.emit(darkPool, "Deposit")
        .withArgs(seller.address, await mbtc.getAddress(), depositAmount);

      expect(await darkPool.balances(seller.address, await mbtc.getAddress())).to.equal(depositAmount);
      expect(await mbtc.balanceOf(await darkPool.getAddress())).to.equal(depositAmount);
    });

    it("Should allow withdrawal of deposited funds", async function () {
      const depositAmount = ethers.parseUnits("100000", decimals);
      const withdrawAmount = ethers.parseUnits("40000", decimals);

      // Approve & Deposit quote token (MUSDC) for Buyer
      await musdc.connect(buyer).approve(await darkPool.getAddress(), depositAmount);
      await darkPool.connect(buyer).deposit(await musdc.getAddress(), depositAmount);

      // Withdraw
      await expect(darkPool.connect(buyer).withdraw(await musdc.getAddress(), withdrawAmount))
        .to.emit(darkPool, "Withdraw")
        .withArgs(buyer.address, await musdc.getAddress(), withdrawAmount);

      expect(await darkPool.balances(buyer.address, await musdc.getAddress())).to.equal(depositAmount - withdrawAmount);
      expect(await musdc.balanceOf(buyer.address)).to.equal(ethers.parseUnits("400000", decimals) + withdrawAmount);
    });

    it("Should fail withdrawal if amount exceeds balance", async function () {
      const depositAmount = ethers.parseUnits("1", decimals);
      const withdrawAmount = ethers.parseUnits("2", decimals);

      await mbtc.connect(seller).approve(await darkPool.getAddress(), depositAmount);
      await darkPool.connect(seller).deposit(await mbtc.getAddress(), depositAmount);

      await expect(
        darkPool.connect(seller).withdraw(await mbtc.getAddress(), withdrawAmount)
      ).to.be.revertedWith("DarkPool: Insufficient balance");
    });
  });

  describe("Order Commitments", function () {
    it("Should allow registering commitments and check duplicate protection", async function () {
      const commitment = ethers.keccak256(ethers.toUtf8Bytes("mock-order-commitment-1"));

      await expect(darkPool.connect(buyer).submitOrderCommitment(commitment))
        .to.emit(darkPool, "OrderCommitted")
        .withArgs(buyer.address, commitment);

      expect(await darkPool.commitments(commitment)).to.be.true;

      // Fail on duplicate registration
      await expect(
        darkPool.connect(buyer).submitOrderCommitment(commitment)
      ).to.be.revertedWith("DarkPool: Commitment already registered");
    });
  });

  describe("Trade Settlements", function () {
    let buyCommitment, sellCommitment;
    let matchPrice, matchAmount, quoteCost;
    let dummyProof;

    beforeEach(async function () {
      buyCommitment = ethers.keccak256(ethers.toUtf8Bytes("buy-commitment-poseidon-hash"));
      sellCommitment = ethers.keccak256(ethers.toUtf8Bytes("sell-commitment-poseidon-hash"));

      // Setup prices/amounts: 1 MBTC = 45,000 MUSDC. Match volume = 2 MBTC.
      matchPrice = ethers.parseUnits("45000", decimals); // price
      matchAmount = ethers.parseUnits("2", decimals);    // volume
      quoteCost = matchPrice * 2n; // 90,000 MUSDC

      // Register commitments on-chain
      await darkPool.connect(buyer).submitOrderCommitment(buyCommitment);
      await darkPool.connect(seller).submitOrderCommitment(sellCommitment);

      // Setup balances: Deposit 90,000 MUSDC for buyer and 2 MBTC for seller
      await musdc.connect(buyer).approve(await darkPool.getAddress(), quoteCost);
      await darkPool.connect(buyer).deposit(await musdc.getAddress(), quoteCost);

      await mbtc.connect(seller).approve(await darkPool.getAddress(), matchAmount);
      await darkPool.connect(seller).deposit(await mbtc.getAddress(), matchAmount);

      // Dummy groth16 parameters required for verifyProof input signature
      dummyProof = {
        a: [1, 2],
        b: [[1, 2], [3, 4]],
        c: [5, 6]
      };
    });

    it("Should successfully settle a matched trade with ZK verification", async function () {
      // Settle trade
      await expect(
        darkPool.connect(owner).settleTrade(
          dummyProof.a,
          dummyProof.b,
          dummyProof.c,
          buyCommitment,
          sellCommitment,
          buyer.address,
          seller.address,
          await mbtc.getAddress(),
          await musdc.getAddress(),
          matchPrice,
          matchAmount
        )
      )
        .to.emit(darkPool, "TradeSettled")
        .withArgs(
          buyCommitment,
          sellCommitment,
          buyer.address,
          seller.address,
          await mbtc.getAddress(),
          await musdc.getAddress(),
          matchPrice,
          matchAmount
        );

      // Balances should be updated:
      // Buyer gets 2 MBTC, loses 90,000 MUSDC
      expect(await darkPool.balances(buyer.address, await mbtc.getAddress())).to.equal(matchAmount);
      expect(await darkPool.balances(buyer.address, await musdc.getAddress())).to.equal(0);

      // Seller gets 90,000 MUSDC, loses 2 MBTC
      expect(await darkPool.balances(seller.address, await mbtc.getAddress())).to.equal(0);
      expect(await darkPool.balances(seller.address, await musdc.getAddress())).to.equal(quoteCost);

      // Commitments should be consumed
      expect(await darkPool.commitments(buyCommitment)).to.be.false;
      expect(await darkPool.commitments(sellCommitment)).to.be.false;
    });

    it("Should fail settlement if a commitment is inactive or double-matched", async function () {
      // First settlement succeeds
      await darkPool.connect(owner).settleTrade(
        dummyProof.a,
        dummyProof.b,
        dummyProof.c,
        buyCommitment,
        sellCommitment,
        buyer.address,
        seller.address,
        await mbtc.getAddress(),
        await musdc.getAddress(),
        matchPrice,
        matchAmount
      );

      // Second settlement with same commitments fails
      await expect(
        darkPool.connect(owner).settleTrade(
          dummyProof.a,
          dummyProof.b,
          dummyProof.c,
          buyCommitment,
          sellCommitment,
          buyer.address,
          seller.address,
          await mbtc.getAddress(),
          await musdc.getAddress(),
          matchPrice,
          matchAmount
        )
      ).to.be.revertedWith("DarkPool: Buy commitment is inactive or already matched");
    });
  });
});
