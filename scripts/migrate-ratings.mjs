import {readFile} from 'node:fs/promises';
import {neon} from '@neondatabase/serverless';
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
const sql=neon(process.env.DATABASE_URL);
for(const statement of (await readFile('server/schema.sql','utf8')).split(';').map(s=>s.trim()).filter(Boolean))await sql.query(statement);
console.log('Ratings schema ready. No votes seeded.');
