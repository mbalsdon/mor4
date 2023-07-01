import DatabaseUpdater from '../../DatabaseUpdater.js';

if (process.argv.length < 3) {
    throw new TypeError('Must supply MOR3 COMBINED sheet .csv filepath! Example: npm run port_mor3_scores ./combined.csv');
}

const dbu = await DatabaseUpdater.build();
const filepath = process.argv[2] as string;
await dbu.portMOR3Scores(filepath);
