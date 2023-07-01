import MORConfig from './MORConfig.js';

import winston from 'winston';
import 'winston-daily-rotate-file';

const LEVEL = MORConfig.LOG_LEVEL || 'info';
const LOG_FILEPATH = MORConfig.LOG_FILEPATH || './logs/bot_%DATE%.log';
const DATE_PATTERN = MORConfig.LOG_DATE_PATTERN || 'YYYY-MM-DD';
const ROTATE_TIME = MORConfig.LOG_ROTATE_TIME || '3d';
const FORMAT = winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.timestamp(),
    winston.format.simple()
);

winston.loggers.add('logger', {
    level: LEVEL,
    format: FORMAT,
    transports: [
        new winston.transports.DailyRotateFile({
            level: LEVEL,
            filename: LOG_FILEPATH,
            datePattern: DATE_PATTERN,
            maxFiles: ROTATE_TIME
        }),
        new winston.transports.Console({
            level: LEVEL
        })
    ]
});
