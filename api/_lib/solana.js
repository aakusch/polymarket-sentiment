const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');

const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const PLATFORM_WALLET = process.env.PLATFORM_WALLET;

function getConnection() {
  return new Connection(SOLANA_RPC, 'confirmed');
}

/**
 * Verify a SOL transfer transaction matches expected parameters.
 * Returns { verified, error }.
 */
async function verifyTransaction(txSignature, expectedAmount, expectedMemo) {
  const connection = getConnection();

  try {
    const tx = await connection.getTransaction(txSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) return { verified: false, error: 'Transaction not found' };
    if (tx.meta.err) return { verified: false, error: 'Transaction failed on-chain' };

    // Check recipient is platform wallet
    const accountKeys = tx.transaction.message.staticAccountKeys || tx.transaction.message.accountKeys;
    const recipientKey = accountKeys[1]?.toString();
    if (recipientKey !== PLATFORM_WALLET) {
      return { verified: false, error: 'Wrong recipient wallet' };
    }

    // Check amount (with 1% tolerance for fees)
    const expectedLamports = Math.round(expectedAmount * LAMPORTS_PER_SOL);
    const preBalance = tx.meta.preBalances[1];
    const postBalance = tx.meta.postBalances[1];
    const received = postBalance - preBalance;
    if (received < expectedLamports * 0.99) {
      return { verified: false, error: 'Amount mismatch' };
    }

    // Check memo if present
    if (expectedMemo) {
      const logs = tx.meta.logMessages || [];
      const hasMemo = logs.some(l => l.includes(expectedMemo));
      if (!hasMemo) {
        return { verified: false, error: 'Memo mismatch' };
      }
    }

    return { verified: true };
  } catch (err) {
    return { verified: false, error: err.message };
  }
}

module.exports = { verifyTransaction, PLATFORM_WALLET, getConnection };
