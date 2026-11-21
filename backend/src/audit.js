async function audit(client, ticketId, actorId, action, details = {}) {
  await client.query(
    `INSERT INTO audit_logs (ticket_id, actor_agent_id, action, details)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [ticketId, actorId || null, action, JSON.stringify(details)]
  );
}
module.exports = audit;
