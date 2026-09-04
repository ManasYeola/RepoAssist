require('dotenv').config({ path: './backend/.env' });
const prisma = require('./prisma');

async function main() {
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE repositories ADD COLUMN IF NOT EXISTS summary TEXT;');
    console.log('Successfully ensured summary column exists in repositories table');
  } catch (err) {
    console.error('Error adding column:', err);
  } finally {
    process.exit(0);
  }
}

main();
