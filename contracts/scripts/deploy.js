const hre = require("hardhat");

async function main() {
  const [deployer, user1, user2] = await hre.ethers.getSigners();

  console.log("==================================================");
  console.log(`Deploying ZK-Dark Pool DEX contracts with account: ${deployer.address}`);
  console.log(`Deployer balance: ${hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address))} ETH`);
  console.log("==================================================");

  // 1. Deploy Verifier
  console.log("Deploying Verifier...");
  const Verifier = await hre.ethers.getContractFactory("Verifier");
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();
  const verifierAddress = await verifier.getAddress();
  console.log(`Verifier deployed to: ${verifierAddress}`);

  // 2. Deploy DarkPool
  console.log("Deploying DarkPool...");
  const DarkPool = await hre.ethers.getContractFactory("DarkPool");
  const darkPool = await DarkPool.deploy(verifierAddress);
  await darkPool.waitForDeployment();
  const darkPoolAddress = await darkPool.getAddress();
  console.log(`DarkPool deployed to: ${darkPoolAddress}`);

  // 3. Deploy Mock Base Token (e.g., Mock Bitcoin - MBTC)
  console.log("Deploying Mock Base Token (MBTC)...");
  const MockToken = await hre.ethers.getContractFactory("MockToken");
  const mbtc = await MockToken.deploy("Mock Bitcoin", "MBTC");
  await mbtc.waitForDeployment();
  const mbtcAddress = await mbtc.getAddress();
  console.log(`Mock Bitcoin (MBTC) deployed to: ${mbtcAddress}`);

  // 4. Deploy Mock Quote Token (e.g., Mock USD Coin - MUSDC)
  console.log("Deploying Mock Quote Token (MUSDC)...");
  const musdc = await MockToken.deploy("Mock USD Coin", "MUSDC");
  await musdc.waitForDeployment();
  const musdcAddress = await musdc.getAddress();
  console.log(`Mock USD Coin (MUSDC) deployed to: ${musdcAddress}`);

  // 5. Transfer mock tokens to user1 and user2 for local testing
  const mintAmount = hre.ethers.parseUnits("1000", 18);
  
  console.log("Minting and distributing mock tokens...");
  await mbtc.mint(user1.address, mintAmount);
  await mbtc.mint(user2.address, mintAmount);
  await musdc.mint(user1.address, mintAmount * 50000n); // Give lots of USDC
  await musdc.mint(user2.address, mintAmount * 50000n);

  console.log(`Distributed 1000 MBTC and 50,000,000 MUSDC to User 1 (${user1.address})`);
  console.log(`Distributed 1000 MBTC and 50,000,000 MUSDC to User 2 (${user2.address})`);
  console.log("==================================================");
  console.log("Deployment finished successfully!");
  console.log("Save the addresses above for your frontend config.");
  console.log("==================================================");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
