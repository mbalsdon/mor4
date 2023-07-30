import DatabaseUpdater from '../../DatabaseUpdater.js';

if (process.argv.length < 3) {
    throw new TypeError('Must supply .db filepath! Example: npm run update_scores ./data/mor4.db');
}

const dbFilepath = process.argv[2] as string;
const dbu = await DatabaseUpdater.build(dbFilepath);
await dbu.updateScores();
