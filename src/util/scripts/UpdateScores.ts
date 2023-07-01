import DatabaseUpdater from '../../DatabaseUpdater.js';

const dbu = await DatabaseUpdater.build();
await dbu.updateScores();
