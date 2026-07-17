// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IVerifier {
    function verifyProof(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint[4] calldata input
    ) external view returns (bool);
}

contract DarkPool is ReentrancyGuard {
    IVerifier public immutable verifier;

    // Balances: user => token => balance
    mapping(address => mapping(address => uint256)) public balances;

    // Registered order commitments: commitment => active (bool)
    // To prevent double matching, commitments are marked false once filled/settled
    mapping(bytes32 => bool) public commitments;

    // Events
    event Deposit(address indexed user, address indexed token, uint256 amount);
    event Withdraw(address indexed user, address indexed token, uint256 amount);
    event OrderCommitted(address indexed user, bytes32 indexed commitment);
    event TradeSettled(
        bytes32 indexed buyCommitment,
        bytes32 indexed sellCommitment,
        address buyer,
        address seller,
        address baseToken,
        address quoteToken,
        uint256 matchPrice,
        uint256 matchAmount
    );

    constructor(address _verifier) {
        require(_verifier != address(0), "DarkPool: Verifier address cannot be zero");
        verifier = IVerifier(_verifier);
    }

    /**
     * @dev Deposit tokens into the Dark Pool to create a private/shielded balance.
     */
    function deposit(address token, uint256 amount) external nonReentrant {
        require(amount > 0, "DarkPool: Deposit amount must be greater than zero");
        balances[msg.sender][token] += amount;
        
        // Transfer tokens to this contract
        bool success = IERC20(token).transferFrom(msg.sender, address(this), amount);
        require(success, "DarkPool: Token transfer failed");

        emit Deposit(msg.sender, token, amount);
    }

    /**
     * @dev Withdraw tokens from the Dark Pool.
     */
    function withdraw(address token, uint256 amount) external nonReentrant {
        require(amount > 0, "DarkPool: Withdraw amount must be greater than zero");
        require(balances[msg.sender][token] >= amount, "DarkPool: Insufficient balance");

        balances[msg.sender][token] -= amount;

        // Transfer tokens back to user
        bool success = IERC20(token).transfer(msg.sender, amount);
        require(success, "DarkPool: Token transfer failed");

        emit Withdraw(msg.sender, token, amount);
    }

    /**
     * @dev Register an order commitment on-chain.
     * This registers the order's cryptographically secure hash to prove it existed before matchmaking.
     */
    function submitOrderCommitment(bytes32 commitment) external {
        require(commitment != bytes32(0), "DarkPool: Commitment cannot be empty");
        require(!commitments[commitment], "DarkPool: Commitment already registered");
        
        commitments[commitment] = true;
        emit OrderCommitted(msg.sender, commitment);
    }

    /**
     * @dev Settle a matched trade between a buyer and a seller.
     * The matching engine submits the public match parameters and the zero-knowledge proof.
     */
    function settleTrade(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        bytes32 buyCommitment,
        bytes32 sellCommitment,
        address buyer,
        address seller,
        address baseToken,
        address quoteToken,
        uint256 matchPrice,
        uint256 matchAmount
    ) external nonReentrant {
        // 1. Verify commitments are active on-chain
        require(commitments[buyCommitment], "DarkPool: Buy commitment is inactive or already matched");
        require(commitments[sellCommitment], "DarkPool: Sell commitment is inactive or already matched");

        // 2. Prepare public inputs for the ZK Verifier
        // We cast the bytes32 commitments and uint256 match metrics to uint256 to fit the SnarkJS output inputs
        uint[4] memory publicInputs;
        publicInputs[0] = uint256(buyCommitment);
        publicInputs[1] = uint256(sellCommitment);
        publicInputs[2] = matchPrice;
        publicInputs[3] = matchAmount;

        // 3. Verify the Zero-Knowledge Proof
        bool proofValid = verifier.verifyProof(a, b, c, publicInputs);
        require(proofValid, "DarkPool: Invalid zero-knowledge match proof");

        // 4. Verify balances can cover the trade
        // Quote token cost = matchPrice * matchAmount (divided by token decimal factor, e.g. for standard scale)
        // For a dark pool, matching price and volume is standard. Quote asset: buyer pays, seller receives.
        // Base asset: seller pays, buyer receives.
        uint256 quoteCost = (matchPrice * matchAmount) / 1e18;
        
        require(balances[buyer][quoteToken] >= quoteCost, "DarkPool: Buyer has insufficient quote balance");
        require(balances[seller][baseToken] >= matchAmount, "DarkPool: Seller has insufficient base balance");

        // 5. Execute internal state updates
        balances[buyer][quoteToken] -= quoteCost;
        balances[buyer][baseToken] += matchAmount;

        balances[seller][baseToken] -= matchAmount;
        balances[seller][quoteToken] += quoteCost;

        // 6. Invalidate commitments to prevent double matching
        commitments[buyCommitment] = false;
        commitments[sellCommitment] = false;

        emit TradeSettled(
            buyCommitment,
            sellCommitment,
            buyer,
            seller,
            baseToken,
            quoteToken,
            matchPrice,
            matchAmount
        );
    }
}
