import 'dotenv/config';
import { app } from './app';
import { deliverMail } from './mail';
import { workflowTx, expireWork } from './workflows';
import { pool } from './db';
const port = Number(process.env.PORT) || 5050;
const server = app.listen(port, () => console.log(`SmartPick backend listening on ${port}`));
const mailTimer = setInterval(() => {
    void deliverMail().catch(() => console.error('Mail worker unavailable.'));
}, 5000);
const workTimer = setInterval(() => {
    void workflowTx(expireWork).catch(() => console.error('Workflow cleanup unavailable.'));
}, 10000);
const cleanupTimer = setInterval(() => {
    void pool.query(`DELETE FROM app_sessions WHERE expires_at<=now(); DELETE FROM app_challenges WHERE expires_at<=now(); UPDATE app_notifications SET body='Expired link',status='SENT' WHERE kind IN ('VERIFY','RESET') AND created_at<now()-interval '30 minutes' AND body<>'Expired link'`).catch(() => console.error('Session cleanup unavailable.'));
}, 60000);
for (const timer of [mailTimer, workTimer, cleanupTimer])
    timer.unref();
process.on('SIGTERM', () => {
    for (const timer of [mailTimer, workTimer, cleanupTimer])
        clearInterval(timer);
    server.close(() => void pool.end());
});
