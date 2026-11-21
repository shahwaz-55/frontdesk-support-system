require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const auth = require('./auth');
const audit = require('./audit');
const { targets, addWorkingMinutes, workingMinutesBetween, MINUTES_PER_DAY } = require('./sla');

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true }));
app.use(express.json({ limit: '1mb' }));
const priorities = ['URGENT','MEDIUM','SMALL'];
const statuses = ['OPEN','IN_PROGRESS','WAITING_CUSTOMER','RESOLVED','CLOSED'];
async function holidaySet(db = pool) {
  const r = await db.query('SELECT holiday_date::text AS day FROM holidays');
  return new Set(r.rows.map(x => x.day));
}
function publicTicket(row) {
  const t = {...row};
  const isActive = !['RESOLVED', 'CLOSED'].includes(t.status);

  t.response_overdue = Boolean(
    isActive &&
    !t.first_response_at &&
    !t.sla_paused_at &&
    t.response_due_at &&
    new Date(t.response_due_at) < new Date()
  );

  t.resolution_overdue = Boolean(
    isActive &&
    !t.sla_paused_at &&
    t.resolution_due_at &&
    new Date(t.resolution_due_at) < new Date()
  );

  t.is_overdue = Boolean(t.response_overdue || t.resolution_overdue);
  return t;
}app.get('/api/health', async (_req,res) => {
  try { const r=await pool.query('SELECT NOW() AS now'); res.json({ok:true,database:'connected',time:r.rows[0].now}); }
  catch { res.status(500).json({ok:false,error:'Database unavailable'}); }
});
app.post('/api/auth/login', async (req,res) => {
  const email=String(req.body.email||'').trim().toLowerCase(), password=String(req.body.password||'');
  if (!email || !password) return res.status(400).json({error:'Email and password required'});
  try {
    const r=await pool.query('SELECT id,name,email,password_hash FROM agents WHERE email=$1',[email]);
    const a=r.rows[0];
    if (!a || !(await bcrypt.compare(password,a.password_hash))) return res.status(401).json({error:'Invalid credentials'});
    const token=jwt.sign({id:a.id,name:a.name,email:a.email},process.env.JWT_SECRET,{expiresIn:'12h'});
    res.json({token,agent:{id:a.id,name:a.name,email:a.email}});
  } catch { res.status(500).json({error:'Login unavailable'}); }
});
app.post('/api/maintenance/close-stale',async(req,res)=>{
  if(!process.env.MAINTENANCE_SECRET||req.headers['x-maintenance-secret']!==process.env.MAINTENANCE_SECRET)return res.status(401).json({error:'Unauthorized'});
  const c=await pool.connect(); let count=0;
  try{
    await c.query('BEGIN'); const holidays=await holidaySet(c);
    const waiting=await c.query(`SELECT id,waiting_since FROM tickets WHERE status='WAITING_CUSTOMER' AND waiting_since IS NOT NULL FOR UPDATE`);
    for(const t of waiting.rows){
      if(workingMinutesBetween(t.waiting_since,new Date(),holidays)>=5*MINUTES_PER_DAY){
        await c.query(`UPDATE tickets SET status='CLOSED',closed_at=NOW(),updated_at=NOW(),sla_paused_at=NULL WHERE id=$1`,[t.id]);
        await audit(c,t.id,null,'AUTO_CLOSED_FOR_NO_CUSTOMER_REPLY',{waitingSince:t.waiting_since,thresholdWorkingMinutes:5*MINUTES_PER_DAY});
        count++;
      }
    }
    await c.query('COMMIT');res.json({closedCount:count});
  }catch(e){await c.query('ROLLBACK');res.status(500).json({error:'Maintenance job failed'});}
  finally{c.release();}
});
app.use('/api',auth);
app.get('/api/me',(req,res)=>res.json({agent:req.agent}));

app.get('/api/tickets',async(req,res)=>{
  const {status,priority,q}=req.query, values=[], where=[];
  if(status){if(!statuses.includes(status))return res.status(400).json({error:'Invalid status'});values.push(status);where.push(`t.status=$${values.length}`);}
  if(priority){if(!priorities.includes(priority))return res.status(400).json({error:'Invalid priority'});values.push(priority);where.push(`t.priority=$${values.length}`);}
  if(q){values.push(`%${String(q).slice(0,150)}%`);where.push(`(t.ticket_number ILIKE $${values.length} OR t.subject ILIKE $${values.length} OR t.customer_email ILIKE $${values.length})`);}
  const r=await pool.query(`SELECT t.*,a.name AS assigned_agent_name FROM tickets t LEFT JOIN agents a ON a.id=t.assigned_agent_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY t.created_at DESC`,values);
  res.json({tickets:r.rows.map(publicTicket)});
});
app.post('/api/tickets',async(req,res)=>{
  const {subject,description,customerName,customerEmail,priority='MEDIUM'}=req.body;
  if(![subject,description,customerName,customerEmail].every(x=>typeof x==='string'&&x.trim()))return res.status(400).json({error:'All ticket fields are required'});
  if(!priorities.includes(priority))return res.status(400).json({error:'Invalid priority'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN'); const now=new Date(), due=targets(priority,now,await holidaySet(client));
    const r=await client.query(`INSERT INTO tickets(subject,description,customer_name,customer_email,priority,response_due_at,resolution_due_at)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [subject.trim(),description.trim(),customerName.trim(),customerEmail.trim().toLowerCase(),priority,due.responseDueAt,due.resolutionDueAt]);
    const t=r.rows[0]; t.ticket_number=`INC-${String(t.id).padStart(4,'0')}`;
    await client.query('UPDATE tickets SET ticket_number=$1 WHERE id=$2',[t.ticket_number,t.id]);
    await audit(client,t.id,req.agent.id,'TICKET_CREATED',{priority, responseDueAt:due.responseDueAt,resolutionDueAt:due.resolutionDueAt});
    await client.query('COMMIT');res.status(201).json({ticket:t});
  }catch(e){await client.query('ROLLBACK');console.error(e);res.status(500).json({error:'Could not create ticket'});}
  finally{client.release();}
});
app.get('/api/tickets/:id',async(req,res)=>{
  const r=await pool.query(`SELECT t.*,a.name AS assigned_agent_name FROM tickets t LEFT JOIN agents a ON a.id=t.assigned_agent_id WHERE t.id=$1`,[req.params.id]);
  if(!r.rows[0])return res.status(404).json({error:'Ticket not found'});
  // This is an authenticated agent-only endpoint. Internal notes are intentionally
  // available only in this agent workspace, never in a customer-facing serializer.
  const [messages,logs]=await Promise.all([
    pool.query(`SELECT m.id,m.ticket_id,m.body,m.is_internal,m.created_at,a.name AS author_name FROM messages m LEFT JOIN agents a ON a.id=m.author_agent_id WHERE m.ticket_id=$1 ORDER BY m.created_at`,[req.params.id]),
    pool.query(`SELECT l.id,l.action,l.details,l.created_at,a.name AS actor_name FROM audit_logs l LEFT JOIN agents a ON a.id=l.actor_agent_id WHERE l.ticket_id=$1 ORDER BY l.created_at,l.id`,[req.params.id])
  ]);
  res.json({ticket:publicTicket(r.rows[0]),messages:messages.rows,audit:logs.rows});
});
app.post('/api/tickets/:id/claim',async(req,res)=>{
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const r=await c.query(`UPDATE tickets SET assigned_agent_id=$1,status='IN_PROGRESS',updated_at=NOW()
      WHERE id=$2 AND assigned_agent_id IS NULL AND status IN ('OPEN','IN_PROGRESS') RETURNING *`,[req.agent.id,req.params.id]);
    if(!r.rows[0]){await c.query('ROLLBACK');return res.status(409).json({error:'Ticket is already assigned or cannot be claimed'});}
    await audit(c,req.params.id,req.agent.id,'TICKET_CLAIMED',{agentId:req.agent.id});
    await c.query('COMMIT');res.json({ticket:r.rows[0]});
  }catch(e){await c.query('ROLLBACK');res.status(500).json({error:'Could not claim ticket'});}
  finally{c.release();}
});
app.patch('/api/tickets/:id',async(req,res)=>{
  const {status,priority}=req.body;
  if(status!==undefined&&!statuses.includes(status))return res.status(400).json({error:'Invalid status'});
  if(priority!==undefined&&!priorities.includes(priority))return res.status(400).json({error:'Invalid priority'});
  if(status===undefined&&priority===undefined)return res.status(400).json({error:'No supported fields to update'});
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const old=await c.query('SELECT * FROM tickets WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!old.rows[0]){await c.query('ROLLBACK');return res.status(404).json({error:'Ticket not found'});}
    const t=old.rows[0], now=new Date(), nextStatus=status??t.status, nextPriority=priority??t.priority;
    const holidays=await holidaySet(c);
    if(t.status==='RESOLVED'&&['OPEN','IN_PROGRESS'].includes(nextStatus)){
      if(!t.resolved_at||workingMinutesBetween(t.resolved_at,now,holidays)>5*MINUTES_PER_DAY){await c.query('ROLLBACK');return res.status(400).json({error:'Reopen window has expired'});}
    }
    if(t.status==='CLOSED'&&['OPEN','IN_PROGRESS','WAITING_CUSTOMER'].includes(nextStatus)){
      await c.query('ROLLBACK');return res.status(400).json({error:'Closed tickets cannot be reopened; create a new ticket'});
    }
    let responseDue=t.response_due_at, resolutionDue=t.resolution_due_at, pausedAt=t.sla_paused_at;
    if(t.status==='RESOLVED'&&['OPEN','IN_PROGRESS'].includes(nextStatus)){
      resolutionDue=targets(nextPriority,now,holidays).resolutionDueAt;
    }
    if(t.status!=='WAITING_CUSTOMER'&&nextStatus==='WAITING_CUSTOMER') pausedAt=now;
    if(t.status==='WAITING_CUSTOMER'&&nextStatus!=='WAITING_CUSTOMER'&&pausedAt){
      const pauseMinutes=workingMinutesBetween(pausedAt,now,holidays);
      if(responseDue&&!t.first_response_at)responseDue=addWorkingMinutes(responseDue,pauseMinutes,holidays);
      if(resolutionDue)resolutionDue=addWorkingMinutes(resolutionDue,pauseMinutes,holidays);
      pausedAt=null;
    }
    // Explicit policy for the assignment's unanswered mid-ticket priority question:
    // changing priority starts the new priority's targets from the change timestamp.
    if(nextPriority!==t.priority){
      if(t.status==='WAITING_CUSTOMER') pausedAt=nextStatus==='WAITING_CUSTOMER'?now:null;
      const due=targets(nextPriority,now,holidays);
      if(!t.first_response_at)responseDue=due.responseDueAt;
      resolutionDue=due.resolutionDueAt;
    }
    const r=await c.query(`UPDATE tickets SET status=$1,priority=$2,updated_at=NOW(),
      resolved_at=CASE WHEN $1='RESOLVED' THEN COALESCE(resolved_at,NOW()) ELSE NULL END,
      closed_at=CASE WHEN $1='CLOSED' THEN NOW() ELSE NULL END,
      waiting_since=CASE WHEN $1='WAITING_CUSTOMER' THEN CASE WHEN status='WAITING_CUSTOMER' THEN waiting_since ELSE NOW() END ELSE NULL END,
      sla_paused_at=$3,response_due_at=$4,resolution_due_at=$5
      WHERE id=$6 RETURNING *`,[nextStatus,nextPriority,pausedAt,responseDue,resolutionDue,req.params.id]);
    await audit(c,t.id,req.agent.id,'TICKET_UPDATED',{fromStatus:t.status,toStatus:nextStatus,fromPriority:t.priority,toPriority:nextPriority,priorityChangeSlaPolicy:nextPriority!==t.priority?'reset_unmet_targets_from_change_time':undefined});
    await c.query('COMMIT');res.json({ticket:publicTicket(r.rows[0])});
  }catch(e){await c.query('ROLLBACK');console.error(e);res.status(500).json({error:'Could not update ticket'});}
  finally{c.release();}
});
app.post('/api/tickets/:id/messages',async(req,res)=>{
  const body=typeof req.body.body==='string'?req.body.body.trim():'', isInternal=req.body.isInternal===true;
  if(!body)return res.status(400).json({error:'Message cannot be empty'});
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const exists=await c.query('SELECT * FROM tickets WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!exists.rows[0]){await c.query('ROLLBACK');return res.status(404).json({error:'Ticket not found'});}
    const t=exists.rows[0];
    const r=await c.query(`INSERT INTO messages(ticket_id,author_agent_id,body,is_internal) VALUES($1,$2,$3,$4)
      RETURNING id,ticket_id,body,is_internal,created_at`,[req.params.id,req.agent.id,body,isInternal]);
    if(!isInternal&&!t.first_response_at){
      await c.query('UPDATE tickets SET first_response_at=NOW(),updated_at=NOW() WHERE id=$1',[req.params.id]);
    }
    await audit(c,req.params.id,req.agent.id,isInternal?'INTERNAL_NOTE_ADDED':'PUBLIC_REPLY_SENT',{messageId:r.rows[0].id});
    await c.query('COMMIT');res.status(201).json({message:r.rows[0]});
  }catch(e){await c.query('ROLLBACK');res.status(500).json({error:'Could not add message'});}
  finally{c.release();}
});
// Invoke daily via scheduler. Customer inactivity is measured in working time,
// excluding weekends and configured holidays.

if(!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32){
  console.error('JWT_SECRET must be set to a random value of at least 32 characters');
  process.exit(1);
}
const port=process.env.PORT||5000;
app.listen(port,()=>console.log(`Frontdesk API listening on ${port}`));
