import DatabaseUpdater from '../../DatabaseUpdater.js';

if (process.argv.length < 4) {
    throw new TypeError('Must supply .db filepath and MOR3 COMBINED sheet .csv filepath! Example: npm run port_mor3_scores ./data/mor4.db ./combined.csv');
}

const dbFilepath = process.argv[2] as string;
const csvFilepath = process.argv[3] as string;
const dbu = await DatabaseUpdater.build(dbFilepath);
await dbu.portMOR3Scores(csvFilepath);
