pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

template OrderMatchVerifier() {
    // --- PRIVATE INPUTS ---
    // Buy Order details
    signal input buyPrice;
    signal input buyAmount;
    signal input buyNonce;

    // Sell Order details
    signal input sellPrice;
    signal input sellAmount;
    signal input sellNonce;

    // --- PUBLIC INPUTS ---
    // Public commitments (hashes of the orders)
    signal input buyCommitment;
    signal input sellCommitment;

    // Public match execution details
    signal input matchPrice;
    signal input matchAmount;

    // --- COMMITMENT VERIFICATION ---
    // Verify Buy Order Commitment: Poseidon(price, amount, nonce)
    component buyHasher = Poseidon(3);
    buyHasher.inputs[0] <== buyPrice;
    buyHasher.inputs[1] <== buyAmount;
    buyHasher.inputs[2] <== buyNonce;
    buyCommitment === buyHasher.out;

    // Verify Sell Order Commitment: Poseidon(price, amount, nonce)
    component sellHasher = Poseidon(3);
    sellHasher.inputs[0] <== sellPrice;
    sellHasher.inputs[1] <== sellAmount;
    sellHasher.inputs[2] <== sellNonce;
    sellCommitment === sellHasher.out;

    // --- PRICE VALIDATION ---
    // Buy Price must be >= Match Price
    component buyPriceCheck = GreaterEqThan(64); // 64-bit integers
    buyPriceCheck.in[0] <== buyPrice;
    buyPriceCheck.in[1] <== matchPrice;
    buyPriceCheck.out === 1;

    // Sell Price must be <= Match Price
    component sellPriceCheck = LessEqThan(64);
    sellPriceCheck.in[0] <== sellPrice;
    sellPriceCheck.in[1] <== matchPrice;
    sellPriceCheck.out === 1;

    // --- VOLUME VALIDATION ---
    // Match Amount must be <= Buy Amount
    component buyAmountCheck = LessEqThan(64);
    buyAmountCheck.in[0] <== matchAmount;
    buyAmountCheck.in[1] <== buyAmount;
    buyAmountCheck.out === 1;

    // Match Amount must be <= Sell Amount
    component sellAmountCheck = LessEqThan(64);
    sellAmountCheck.in[0] <== matchAmount;
    sellAmountCheck.in[1] <== sellAmount;
    sellAmountCheck.out === 1;
}

component main {public [buyCommitment, sellCommitment, matchPrice, matchAmount]} = OrderMatchVerifier();
