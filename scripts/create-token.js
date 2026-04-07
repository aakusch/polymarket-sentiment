#!/usr/bin/env node
/**
 * Create PMSI SPL Token on Solana.
 *
 * Prerequisites:
 *   npm install @solana/spl-token
 *   Solana CLI installed with a keypair at ~/.config/solana/id.json
 *
 * Usage:
 *   node scripts/create-token.js [--devnet]
 *
 * This will:
 *   1. Create a new SPL token mint
 *   2. Create an associated token account
 *   3. Mint initial supply
 *   4. Print the mint address (CA) to set as PMSI_TOKEN_MINT
 */

const { Connection, Keypair, PublicKey, clusterApiUrl } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const DECIMALS = 6;
const INITIAL_SUPPLY = 1_000_000; // 1M tokens
const isDevnet = process.argv.includes('--devnet');

async function main() {
  // Dynamic import for ESM spl-token
  let splToken;
  try {
    splToken = require('@solana/spl-token');
  } catch {
    console.error('Missing @solana/spl-token. Run: npm install @solana/spl-token');
    process.exit(1);
  }

  const cluster = isDevnet ? 'devnet' : 'mainnet-beta';
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl(cluster);
  const connection = new Connection(rpcUrl, 'confirmed');

  console.log(`Network: ${cluster}`);
  console.log(`RPC: ${rpcUrl}`);

  // Load payer keypair
  const keypairPath = path.join(process.env.HOME, '.config/solana/id.json');
  if (!fs.existsSync(keypairPath)) {
    console.error(`No keypair found at ${keypairPath}`);
    console.error('Run: solana-keygen new');
    process.exit(1);
  }

  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8')))
  );
  console.log(`Payer: ${payer.publicKey.toBase58()}`);

  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance: ${balance / 1e9} SOL`);
  if (balance < 0.05 * 1e9) {
    console.error('Insufficient SOL. Need at least 0.05 SOL for token creation.');
    if (isDevnet) console.log('Run: solana airdrop 2 --url devnet');
    process.exit(1);
  }

  // Create mint
  console.log('\nCreating PMSI token mint...');
  const mint = await splToken.createMint(
    connection,
    payer,
    payer.publicKey,  // mint authority
    payer.publicKey,  // freeze authority
    DECIMALS,
  );
  console.log(`Mint created: ${mint.toBase58()}`);

  // Create token account for payer
  console.log('Creating token account...');
  const tokenAccount = await splToken.getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    payer.publicKey,
  );
  console.log(`Token account: ${tokenAccount.address.toBase58()}`);

  // Mint initial supply
  const supplyRaw = INITIAL_SUPPLY * Math.pow(10, DECIMALS);
  console.log(`Minting ${INITIAL_SUPPLY.toLocaleString()} PMSI...`);
  await splToken.mintTo(
    connection,
    payer,
    mint,
    tokenAccount.address,
    payer,
    supplyRaw,
  );

  console.log('\n========================================');
  console.log('PMSI Token Created Successfully!');
  console.log('========================================');
  console.log(`Token Mint (CA): ${mint.toBase58()}`);
  console.log(`Decimals: ${DECIMALS}`);
  console.log(`Initial Supply: ${INITIAL_SUPPLY.toLocaleString()} PMSI`);
  console.log(`\nAdd to .env:`);
  console.log(`PMSI_TOKEN_MINT=${mint.toBase58()}`);
  console.log('========================================');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
