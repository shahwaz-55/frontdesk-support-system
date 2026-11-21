require('dotenv').config();
const bcrypt=require('bcryptjs'); const pool=require('./db');
(async()=>{try{
 const hash=await bcrypt.hash('Frontdesk123!',12);
 await pool.query(`INSERT INTO agents(name,email,password_hash) VALUES($1,$2,$3)
 ON CONFLICT(email) DO NOTHING`,['Demo Agent','agent@frontdesk.local',hash]);
 await pool.query(`INSERT INTO holidays(holiday_date,name) VALUES ('2026-12-25','Christmas') ON CONFLICT DO NOTHING`);
 console.log('Seed complete. Demo login: agent@frontdesk.local / Frontdesk123!');
}catch(e){console.error(e);process.exitCode=1;}finally{await pool.end();}})();
