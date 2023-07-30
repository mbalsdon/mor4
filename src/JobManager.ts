import { MORJob } from './util/Common.js';

import { Job, scheduleJob } from 'node-schedule';

import './util/Logger.js';
import { loggers } from 'winston';
const logger = loggers.get('logger');

/**
 * Manages and automates job routines.
 */
export default class JobManager {
    private _jobs: MORJob[];
    private _activeJobs: Job[];

    /* ------------------------------------------------------------------------------------------------------------------------------------ */
    /* ---------------------------------------------------------------PUBLIC--------------------------------------------------------------- */
    /* ------------------------------------------------------------------------------------------------------------------------------------ */

    /**
     * Construct job manager.
     */
    public constructor () {
        logger.debug('JobManager::constructor - constructing JobManager instance...');

        this._jobs = [];
        this._activeJobs = [];
    }

    /**
     * Return jobs.
     * @returns {MORJob[]}
     */
    public get jobs (): MORJob[] {
        return this._jobs;
    }

    /**
     * Return active jobs.
     * @returns {Job[]}
     */
    public get activeJobs (): Job[] {
        return this._activeJobs;
    }

    /**
     * Start schedulers for all jobs.
     * @returns {void}
     */
    public start (): void {
        logger.info('JobManager::start - starting job timers...');

        for (const job of this._jobs) {
            logger.debug(`JobManager::start - starting timer for ${job.name}...`);

            const scheduledJob = scheduleJob(job.name, job.rule, job.callback);
            scheduledJob.on('error', (error) => {
                logger.error(`JobManager - scheduled job ${job.name} failed; ${error}`);
                logger.warn(`JobManager - stopping scheduler for ${job.name}...`);
                scheduledJob.cancel();
            });

            this._activeJobs.push(scheduledJob);
        }
    }

    /**
     * Add a scheduled job.
     * @param {MORJob} job
     * @returns {void}
     */
    public addJob (job: MORJob): void {
        logger.debug(`JobManager::addJob - adding job "${job.name}" with timer "${job.rule}"...`);
        this._jobs.push(job);
    }

    /* ------------------------------------------------------------------------------------------------------------------------------------ */
    /* ---------------------------------------------------------------PRIVATE-------------------------------------------------------------- */
    /* ------------------------------------------------------------------------------------------------------------------------------------ */
}
