require('dotenv').config();
const fs=require('fs'); const path=require('path'); const pool=require('./db');
(async()=>{try{const sql=fs.readFileSync(path.join(__dirname,'../sql/schema.sql'),'utf8');await pool.query(sql);console.log('Database schema created');}catch(e){console.error(e);process.exitCode=1;}finally{await pool.end();}})();
