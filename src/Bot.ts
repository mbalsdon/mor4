import DatabaseManager from './DatabaseManager.js';
import OsuWrapper from './OsuWrapper.js';
import MORConfig from './util/MORConfig.js';
import {  MORMod, MORScore, MORScoreKey, MORUser, MORUserKey, convertOsuMods, defined, isNull, modStringToArray, osuScoreToMORScore, sortOsuMods } from './util/Common.js';

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, CacheType, ChatInputCommandInteraction, Client, EmbedBuilder, GatewayIntentBits, Interaction, PermissionFlagsBits, REST, Routes, SlashCommandBuilder } from 'discord.js';

import './util/Logger.js';
import { loggers } from 'winston';
const logger = loggers.get('logger');

/**
 * Discord bot client.
 * @see {@link https://old.discordjs.dev/#/docs/}
 */
export default class Bot {
    private _dbm: DatabaseManager;
    private _osu: OsuWrapper;
    private _discord: Client;

    /* ------------------------------------------------------------------------------------------------------------------------------------ */
    /* ---------------------------------------------------------------PUBLIC--------------------------------------------------------------- */
    /* ------------------------------------------------------------------------------------------------------------------------------------ */

    /**
     * Build osu! client and construct Bot for given database file.
     * @param {string} filename
     * @returns {Promise<Bot>}
     */
    public static async build (filename: string): Promise<Bot> {
        logger.debug(`Bot::build - building Bot instance for "${filename}"...`);

        const osu = await OsuWrapper.build();
        return new Bot(filename, osu);
    }

    /**
     * Start the bot.
     * @returns {Promise<void>}
     */
    public async start (): Promise<void> {
        logger.info(`Bot::start - starting Discord bot for "${this._dbm.filename}"...`);

        this._discord.once('ready', () => {
            logger.info('Bot - Discord bot is online!');
        });

        this._discord.on('interactionCreate', async (interaction) => {
            try {
                await this.processInteraction(interaction);
            } catch (error) {
                logger.error(`Bot - failed to process interaction! (${(error as Error).name}: ${(error as Error).message})`);
                await this.replyWithError(interaction as ChatInputCommandInteraction<CacheType>, error as Error);
            }
        });

        this._discord.on('error', async (error) => {
            logger.error(`Bot - ran into an error outside of interaction handler; going offline... (${error.name}: ${error.message})`);
            this._discord.removeAllListeners();
        });

        // Authenticate the bot; must be the last line of code
        await this._discord.login(MORConfig.DISCORD_API_BOT_TOKEN);
    }

    /* ------------------------------------------------------------------------------------------------------------------------------------ */
    /* ---------------------------------------------------------------PRIVATE-------------------------------------------------------------- */
    /* ------------------------------------------------------------------------------------------------------------------------------------ */

    /**
     * Construct discord bot.
     * Not meant to be called directly - use Bot.build() instead!
     * @param {string} filename
     * @param {OsuWrapper} osu
     */
    private constructor (filename: string, osu: OsuWrapper) {
        logger.debug(`Bot::constructor - constructing Bot instance for "${filename}"...`);

        this._dbm = new DatabaseManager(filename);
        this._osu = osu;
        this._discord = new Client({ intents: [ GatewayIntentBits.Guilds ] });

        // Update the bot's slash commands
        const moderatorPermFlags = PermissionFlagsBits.ModerateMembers;
        const userPermFlags = PermissionFlagsBits.SendMessages;
        const commands = [
            new SlashCommandBuilder()
                .setName('help')
                .setDescription('List the bot\'s commands')
                .setDMPermission(false)
                .setDefaultMemberPermissions(userPermFlags),
            new SlashCommandBuilder()
                .setName('ping')
                .setDescription('Check if the bot is alive')
                .setDMPermission(false)
                .setDefaultMemberPermissions(userPermFlags),
            new SlashCommandBuilder()
                .setName('size')
                .setDescription('Display the number of database entires')
                .setDMPermission(false)
                .setDefaultMemberPermissions(userPermFlags),
            new SlashCommandBuilder()
                .setName('users')
                .setDescription('Display the leaderboard for database users')
                .addStringOption((option) => option.setName('country_code')
                    .setDescription('The country code to filter users by (e.g. PL)')
                    .setRequired(false))
                .addStringOption((option) => option.setName('sort')
                    .setDescription('How to sort the users (defaults to pp)')
                    .setRequired(false)
                    .addChoices(
                        { name: 'pp', value: 'pp' },
                        { name: 'accuracy', value: 'accuracy' },
                        { name: 'playtime', value: 'playtime' },
                        { name: 'playcount', value: 'playcount' },
                        { name: 'ranked_score', value: 'ranked_score' },
                        { name: 'replays_watched', value: 'replays_watched' },
                        { name: 'top1s', value: 'top1s' },
                        { name: 'top2s', value: 'top2s' },
                        { name: 'top3s', value: 'top3s' }
                    ))
                .setDMPermission(false)
                .setDefaultMemberPermissions(userPermFlags),
            new SlashCommandBuilder()
                .setName('user')
                .setDescription('Display statistics for a database user')
                .addStringOption((option) => option.setName('username')
                    .setDescription('The username of the player')
                    .setRequired(true))
                .setDMPermission(false)
                .setDefaultMemberPermissions(userPermFlags),
            new SlashCommandBuilder()
                .setName('add_user')
                .setDescription('Add a user to the database')
                .addStringOption((option) => option.setName('username')
                    .setDescription('The username of the player')
                    .setRequired(true))
                .addBooleanOption((option) => option.setName('track')
                    .setDescription('Whether or not to track the user\'s plays')
                    .setRequired(true))
                .setDMPermission(false)
                .setDefaultMemberPermissions(moderatorPermFlags),
            new SlashCommandBuilder()
                .setName('remove_user')
                .setDescription('Remove a user from the database')
                .addStringOption((option) => option.setName('username')
                    .setDescription('The username of the player')
                    .setRequired(true))
                .addBooleanOption((option) => option.setName('remove_scores')
                    .setDescription('Whether or not to remove the user\'s scores')
                    .setRequired(true))
                .setDMPermission(false)
                .setDefaultMemberPermissions(moderatorPermFlags),
            new SlashCommandBuilder()
                .setName('add_score')
                .setDescription('Add a score to the database manually')
                .addStringOption((option) => option.setName('score_id')
                    .setDescription('The ID of the score (given https://osu.ppy.sh/scores/osu/4083979228, 4083979228 is the ID)')
                    .setRequired(true))
                .setDMPermission(false)
                .setDefaultMemberPermissions(userPermFlags),
            new SlashCommandBuilder()
                .setName('remove_score')
                .setDescription('Remove a score from the database manually')
                .addStringOption((option) => option.setName('score_id')
                    .setDescription('The ID of the score (given https://osu.ppy.sh/scores/osu/4083979228, 4083979228 is the ID)')
                    .setRequired(true))
                .setDMPermission(false)
                .setDefaultMemberPermissions(moderatorPermFlags),
            new SlashCommandBuilder()
                .setName('scores')
                .setDescription('Display the leaderboard for scores set by database users')
                .addStringOption((option) => option.setName('mods')
                    .setDescription('Which mods to filter the scores by (defaults to all mods)')
                    .setRequired(false))
                .addStringOption((option) => option.setName('beatmap_id')
                    .setDescription('The ID of a specific beatmap (given https://osu.ppy.sh/beatmapsets/141#osu/315, 315 is the ID)')
                    .setRequired(false))
                .addStringOption((option) => option.setName('sort')
                    .setDescription('How to sort the scores (defaults to pp)')
                    .setRequired(false)
                    .addChoices(
                        { name: 'pp', value: 'pp' },
                        { name: 'accuracy', value: 'accuracy' },
                        { name: 'star_rating', value: 'star_rating' },
                        { name: 'date_set', value: 'date_set' }
                    ))
                .setDMPermission(false)
                .setDefaultMemberPermissions(userPermFlags)
        ].map((command) => command.toJSON());
        const rest = new REST({ version: '10' }).setToken(MORConfig.DISCORD_API_BOT_TOKEN);
        rest.put(Routes.applicationCommands(MORConfig.DISCORD_API_CLIENT_ID), { body: commands });
    }

    /**
     * Handle bot interaction.
     * @param {Interaction<CacheType>} interaction
     * @returns {Promise<void>}
     */
    private async processInteraction (interaction: Interaction<CacheType>): Promise<void> {
        logger.debug('Bot::processInteraction - processing interaction...');

        if (!interaction.isChatInputCommand()) {
            return;
        }

        const commandName = interaction.commandName;
        logger.info(`Bot - received command "${commandName}"; processing...`);

        // NOTE: Coupled with constructor and helpCmd
        await interaction.deferReply();
        if (commandName === 'help') {
            await this.helpCmd(interaction);
        } else if (commandName === 'ping') {
            await this.pingCmd(interaction);
        } else if (commandName === 'size') {
            await this.sizeCmd(interaction);
        } else if (commandName === 'users') {
            await this.usersCmd(interaction);
        } else if (commandName === 'user') {
            await this.userCmd(interaction);
        } else if (commandName === 'add_user') {
            await this.addUserCmd(interaction);
        } else if (commandName === 'remove_user') {
            await this.removeUserCmd(interaction);
        } else if (commandName === 'add_score') {
            await this.addScoreCmd(interaction);
        } else if (commandName === 'remove_score') {
            await this.removeScoreCmd(interaction);
        } else if (commandName === 'scores') {
            await this.scoresCmd(interaction);
        } else {
            throw new TypeError(`/${commandName} is not implemented yet!`);
        }
    }

    /**
     * Reply to user with error message.
     * @param {ChatInputCommandInteraction<CacheType>} interaction
     * @param {Error} error
     */
    private async replyWithError (interaction: ChatInputCommandInteraction<CacheType>, error: Error): Promise<void> {
        logger.debug('Bot::replyWithError - sending error message...');

        const errorMessage = '```You broke the bot!\n' +
            `${error.name}: ${error.message}\n\n` +
            'DM spreadnuts on Discord or open an issue at https://github.com/mbalsdon/mor4/issues if you believe that this is a bug.```';
        await interaction.editReply(errorMessage);
    }

    /**
     * Reply to interaction with help message.
     * @param {ChatInputCommandInteraction<CacheType>} interaction
     * @returns {Promise<void>}
     */
    private async helpCmd (interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
        logger.debug('Bot::helpCmd - sending help message...');

        const githubLink = 'https://github.com/mbalsdon/mor4';
        const embed = new EmbedBuilder()
            .setColor(MORConfig.DISCORD_BOT_EMBED_COLOR)
            .setAuthor({ name: 'MOR4 Commands', iconURL: MORConfig.DISCORD_BOT_ICON_URL, url: githubLink })
            .setDescription('`help` - List the bot\'s commands\n' +
                '`ping` - Check if the bot is alive\n' +
                '`size` - Display the number of database entires\n' +
                '`users` - Display the leaderboard for database users\n' +
                '`user` - Display statistics for a database user\n' +
                '`add_user` - Add a user to the database [MOD COMMAND]\n' +
                '`remove_user` - Remove a user from the database [MOD COMMAND]\n' +
                '`add_score` - Add a score to the database manually\n' +
                '`remove_score` - Remove a score from the database manually [MOD COMMAND]\n' +
                '`scores` - Display the leaderboard for scores set by database users\n')
            .setFooter({ text: githubLink });

        await interaction.editReply({ embeds: [ embed ] });
    }

    /**
     * Reply to interaction with pong.
     * @param {ChatInputCommandInteraction<CacheType>} interaction
     * @returns {Promise<void>}
     */
    private async pingCmd (interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
        logger.debug('Bot::pingCmd - pinging...');

        await interaction.editReply('𝓅𝑜𝓃𝑔 😘');
    }

    /**
     * Reply to interaction with number of database entries.
     * @param {ChatInputCommandInteraction<CacheType>} interaction
     * @returns {Promise<void>}
     */
    private async sizeCmd (interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
        logger.debug('Bot::sizeCmd - sending database size...');

        const numUsers = await this._dbm.getNumUsers();
        let desc = `**USERS:** ${numUsers} ${numUsers === 1 ? 'entry' : 'entries'}\n`;
        for (const key in MORMod) {
            const numScores = await this._dbm.getRowCount(key);
            desc = desc + `**${key}:** ${numScores} ${numScores === 1 ? 'entry': 'entries'}\n`;
        }

        const embed = new EmbedBuilder()
            .setColor(MORConfig.DISCORD_BOT_EMBED_COLOR)
            .setAuthor({ name: `${MORConfig.DISCORD_BOT_SERVER_NAME} Database Size`, iconURL: MORConfig.DISCORD_BOT_ICON_URL })
            .setDescription(desc);

        await interaction.editReply({ embeds: [ embed ] });
    }

    /**
     * Reply to interaction with leaderboard for database users.
     * @param {ChatInputCommandInteraction<CacheType>} interaction
     * @returns {Promise<void>}
     */
    private async usersCmd (interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
        let countryCode = interaction.options.getString('country_code');
        const sortFlag = isNull(interaction.options.getString('sort')) ? 'pp' : interaction.options.getString('sort');
        logger.debug(`Bot::usersCmd - sending database user leaderboard... (countryCode = ${countryCode}, sortFlag = ${sortFlag})`);

        let users = await this._dbm.getUsers();

        // Filter and sort users depending on user input
        if (!isNull(countryCode)) {
            countryCode = (countryCode as string).toUpperCase();
            users = users.filter((user) => user[MORUserKey.COUNTRY_CODE] === countryCode);
        }
        if (sortFlag === 'pp') {
            users.sort((a, b) => a[MORUserKey.PP] - b[MORUserKey.PP]);
        } else if (sortFlag === 'accuracy') {
            users.sort((a, b) => a[MORUserKey.ACCURACY] - b[MORUserKey.ACCURACY]);
        } else if (sortFlag === 'playtime') {
            users.sort((a, b) => a[MORUserKey.PLAYTIME] - b[MORUserKey.PLAYTIME]);
        } else if (sortFlag === 'playcount') {
            users.sort((a, b) => a[MORUserKey.PLAYCOUNT] - b[MORUserKey.PLAYCOUNT]);
        } else if (sortFlag === 'ranked_score') {
            users.sort((a, b) => a[MORUserKey.RANKED_SCORE] - b[MORUserKey.RANKED_SCORE]);
        } else if (sortFlag === 'replays_watched') {
            users.sort((a, b) => a[MORUserKey.REPLAYS_WATCHED] - b[MORUserKey.REPLAYS_WATCHED]);
        } else if (sortFlag === 'top1s') {
            users.sort((a, b) => a[MORUserKey.TOP_1S] - b[MORUserKey.TOP_1S]);
        } else if (sortFlag === 'top2s') {
            users.sort((a, b) => a[MORUserKey.TOP_2S] - b[MORUserKey.TOP_2S]);
        } else if (sortFlag === 'top3s') {
            users.sort((a, b) => a[MORUserKey.TOP_3S] - b[MORUserKey.TOP_3S]);
        }

        // Fuck you Zeklewa
        users.sort((a, b) => (b[MORUserKey.AUTOTRACK] && !a[MORUserKey.AUTOTRACK]) ? 1 : -1);

        const embed = new EmbedBuilder()
            .setColor(MORConfig.DISCORD_BOT_EMBED_COLOR)
            .setAuthor({ name: `${MORConfig.DISCORD_BOT_SERVER_NAME} User Leaderboard`, iconURL: MORConfig.DISCORD_BOT_ICON_URL });

        let currentPage = 1;
        const perPage = 5;
        const numPages = Math.ceil(users.length / perPage);
        if (numPages === 0) {
            embed.setDescription('▸ No users found!');
            await interaction.editReply({ embeds: [ embed ] });
            return;
        }

        /**
         * Update usersCmd embed for given page.
         * @param {number} page
         * @returns {EmbedBuilder}
         */
        const updateEmbed = (page: number): void => {
            if ((page < 1) || (page > numPages)) {
                throw new RangeError(`Bot::usersCmd::updateEmbed - page must be between 1 and ${numPages}; this should never happen!`);
            }

            // May have to display less than <perPage> users if on the last page
            const userPageLimit = ((page === numPages) && (users.length % perPage)) ? (users.length % perPage) : perPage;

            let desc = isNull(countryCode) ? '' : `\`COUNTRY CODE: ${countryCode}\`\n`;
            desc = desc + `\`SORT BY: ${sortFlag}\`\n\n`;
            for (let i = 0; i < userPageLimit; ++i) {
                const userIdx = perPage * (page - 1) + i;
                const user = users[userIdx] as MORUser;

                const countryCodeEmoji = `:flag_${user[MORUserKey.COUNTRY_CODE].toLowerCase()}:`;
                const usernameString = `[${user[MORUserKey.USERNAME]}](https://osu.ppy.sh/users/${user[MORUserKey.USER_ID]})`;
                const globalRankString = isNull(user[MORUserKey.GLOBAL_RANK]) ? 'N/A' : `#${user[MORUserKey.GLOBAL_RANK].toLocaleString()}`;
                const ppString = `${Math.round(user[MORUserKey.PP]).toLocaleString()}pp`;
                const accuracyString = `${Math.round(user[MORUserKey.ACCURACY] * 100) / 100}%`;
                const playtimeString = `${Math.round(user[MORUserKey.PLAYTIME] / 3600).toLocaleString()}hrs`;
                const playcountString = user[MORUserKey.PLAYCOUNT].toLocaleString();
                const rankedScoreString = user[MORUserKey.RANKED_SCORE].toLocaleString();
                const replaysWatchedString = user[MORUserKey.REPLAYS_WATCHED].toLocaleString();
                const lineString = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';

                desc = desc + `**${userIdx + 1}.** ${countryCodeEmoji} **${usernameString}** **(${globalRankString} | ${ppString} | ${accuracyString} | ${playtimeString})**\n`;
                desc = desc + `▸ :video_game: Playcount: ${playcountString}\n`;
                desc = desc + `▸ :fishing_pole_and_fish: Ranked Score: ${rankedScoreString}\n`;
                desc = desc + `▸ :movie_camera: Replays Watched: ${replaysWatchedString}\n`;
                if (i !== userPageLimit - 1) {
                    desc = desc + `${lineString}\n`;
                }
            }

            const userPfpIdx = perPage * (page - 1);
            const pfpLink = (users[userPfpIdx] as MORUser)[MORUserKey.PFP_IMAGE_URL];

            embed.setThumbnail(pfpLink);
            embed.setDescription(desc);
        };

        updateEmbed(currentPage);

        // Use date as hash for button IDs
        const buttonHash = new Date(Date.now()).toISOString();
        const buttons = new ActionRowBuilder<ButtonBuilder>()
            .addComponents([
                new ButtonBuilder()
                    .setCustomId(`Users_start_${buttonHash}`)
                    .setLabel('◀◀')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`Users_prev_${buttonHash}`)
                    .setLabel('◀')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`Users_next_${buttonHash}`)
                    .setLabel('▶')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(numPages === 1),
                new ButtonBuilder()
                    .setCustomId(`Users_last_${buttonHash}`)
                    .setLabel('▶▶')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(numPages === 1)
            ]);

        /**
         * Update buttons for embed.
         * @param {Interaction<CacheType>} interaction
         * @returns {Promise<void>}
         */
        const updateButtons = async (interaction: Interaction<CacheType>): Promise<void> => {
            if (!interaction.isButton()) {
                return;
            }

            const buttonID = interaction.customId;
            logger.debug(`Bot::usersCmd::updateButtons - button "${buttonID}" was pressed`);

            if (buttonID === `Users_start_${buttonHash}`) {
                currentPage = 1;
                (buttons.components[0] as ButtonBuilder).setDisabled(true);
                (buttons.components[1] as ButtonBuilder).setDisabled(true);
                (buttons.components[2] as ButtonBuilder).setDisabled(false);
                (buttons.components[3] as ButtonBuilder).setDisabled(false);
            } else if (buttonID === `Users_prev_${buttonHash}`) {
                currentPage--;
                (buttons.components[0] as ButtonBuilder).setDisabled(currentPage === 1);
                (buttons.components[1] as ButtonBuilder).setDisabled(currentPage === 1);
                (buttons.components[2] as ButtonBuilder).setDisabled(false);
                (buttons.components[3] as ButtonBuilder).setDisabled(false);
            } else if (buttonID === `Users_next_${buttonHash}`) {
                currentPage++;
                (buttons.components[0] as ButtonBuilder).setDisabled(false);
                (buttons.components[1] as ButtonBuilder).setDisabled(false);
                (buttons.components[2] as ButtonBuilder).setDisabled(currentPage === numPages);
                (buttons.components[3] as ButtonBuilder).setDisabled(currentPage === numPages);
            } else if (buttonID === `Users_last_${buttonHash}`) {
                currentPage = numPages;
                (buttons.components[0] as ButtonBuilder).setDisabled(false);
                (buttons.components[1] as ButtonBuilder).setDisabled(false);
                (buttons.components[2] as ButtonBuilder).setDisabled(true);
                (buttons.components[3] as ButtonBuilder).setDisabled(true);
            } else {
                return;
            }

            updateEmbed(currentPage);
            await interaction.update({ embeds: [ embed ], components: [ buttons ] });
        };

        // Listen for button presses for 60 seconds
        logger.debug('Bot::usersCmd - listening for button presses...');
        this._discord.on('interactionCreate', updateButtons);
        setTimeout(() => {
            logger.debug('Bot::usersCmd - no longer listening for button presses!');
            this._discord.off('interactionCreate', updateButtons);
            interaction.editReply({ embeds: [ embed ], components: [] });
        }, 60000);

        await interaction.editReply({ embeds: [ embed ], components: [ buttons ] });
        return;
    }

    /**
     * Reply to interaction with statistics for a database user.
     * @param {ChatInputCommandInteraction<CacheType>} interaction
     * @returns {Promise<void>}
     */
    private async userCmd (interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
        const username = interaction.options.getString('username') as string;
        logger.debug(`Bot::userCmd - sending database user statistics for ${username}...`);

        const embed = new EmbedBuilder()
            .setColor(MORConfig.DISCORD_BOT_EMBED_COLOR)
            .setAuthor({ name: `${MORConfig.DISCORD_BOT_SERVER_NAME} Profile for ${username}`, iconURL: MORConfig.DISCORD_BOT_ICON_URL, url: new URL(`https://osu.ppy.sh/users/${username}`).href });

        const osuUser = await this._osu.getUser(username);
        if (!defined(osuUser)) {
            embed.setDescription(`▸ Could not retrieve user "${username}" from osu!`);
            await interaction.editReply({ embeds: [ embed ] });
            return;
        }

        let dbUsers = await this._dbm.getUsers();
        let dbUser = dbUsers.find((u) => u[MORUserKey.USERNAME].toLowerCase() === username.toLowerCase());
        if (!defined(dbUser)) {
            embed.setThumbnail(osuUser.avatar_url);
            embed.setDescription(`▸ Could not find user "${username}" in ${MORConfig.DISCORD_BOT_SERVER_NAME} database!`);
            await interaction.editReply({ embeds: [ embed ] });
            return;
        }
        dbUser = dbUser as MORUser;

        // Determine database rank
        dbUsers.sort((a, b) => b[MORUserKey.PP] - a[MORUserKey.PP]);
        dbUsers = dbUsers.filter((u) => u[MORUserKey.AUTOTRACK]);
        const dbIdx = dbUsers.indexOf(dbUser);

        const daysSincePeak = Math.round((new Date(Date.now()).getTime() - new Date(osuUser.rank_highest.updated_at).getTime()) / 86400000);
        const dbRankString = (dbIdx === -1 ? 'N/A' : `#${(dbIdx + 1).toLocaleString()}`);
        const countryCodeEmoji = `:flag_${osuUser.country_code.toLowerCase()}:`;
        const countryRankString = (isNull(osuUser.statistics.country_rank) ? 'N/A' : `#${osuUser.statistics.country_rank.toLocaleString()}`);
        const globalRankString = (isNull(osuUser.statistics.global_rank) ? 'N/A' : `#${osuUser.statistics.global_rank.toLocaleString()}`);
        const peakRankString = `#${osuUser.rank_highest.rank} (${daysSincePeak} ${daysSincePeak === 1 ? 'day ago' : 'days ago'})`;
        const ppString = `${Math.round(osuUser.statistics.pp).toLocaleString()}pp`;
        const accuracyString = `${osuUser.statistics.hit_accuracy.toFixed(2)}%`;
        const badgesString = osuUser.badges.length.toLocaleString();
        const medalsString = osuUser.user_achievements.length.toLocaleString();
        const levelString = `${osuUser.statistics.level.current}.${osuUser.statistics.level.progress}`;
        const rankedScoreString = osuUser.statistics.ranked_score.toLocaleString();
        const totalPlaytimeString = Math.round(osuUser.statistics.play_time / 3600).toLocaleString();
        const monthPlaycount = (osuUser.monthly_playcounts.length === 0) ? 'N/A' : osuUser.monthly_playcounts.slice(-1)[0].count.toLocaleString();
        const playcountString = `${osuUser.statistics.play_count.toLocaleString()} (${monthPlaycount} this month)`;
        const monthReplaysWatched = (osuUser.replays_watched_counts.length === 0) ? 'N/A' : osuUser.replays_watched_counts.slice(-1)[0].count.toLocaleString();
        const replaysWatchedString = `${osuUser.statistics.replays_watched_by_others.toLocaleString()} (${monthReplaysWatched} this month)`;
        const joinedString = `${new Date(osuUser.join_date).toLocaleString('default', { month: 'long' })} ${new Date(osuUser.join_date).toLocaleString('default', { year: 'numeric' })}`;
        const topsString = `${dbUser[MORUserKey.TOP_1S]}/${dbUser[MORUserKey.TOP_2S]}/${dbUser[MORUserKey.TOP_3S]}`;

        let desc = `▸ :trophy: **${MORConfig.DISCORD_BOT_SERVER_NAME} Rank:** ${dbRankString}\n`;
        desc = desc + `▸ ${countryCodeEmoji} **Country Rank:** ${countryRankString}\n`;
        desc = desc + `▸ :globe_with_meridians: **Global Rank:** ${globalRankString}\n`;
        desc = desc + `▸ :mountain_snow: **Peak Rank:** ${peakRankString}\n`;
        desc = desc + `▸ :farmer: **PP:** ${ppString}\n`;
        desc = desc + `▸ :dart: **Accuracy:** ${accuracyString}\n\n`;

        desc = desc + `▸ :reminder_ribbon: **Badges:** ${badgesString}\n`;
        desc = desc + `▸ :military_medal: **Medals:** ${medalsString}\n`;
        desc = desc + `▸ :books: **Level:** ${levelString}\n`;
        desc = desc + `▸ :fishing_pole_and_fish: **Ranked Score:** ${rankedScoreString}\n`;
        desc = desc + `▸ :stopwatch: **Total Playtime:** ${totalPlaytimeString}\n`;
        desc = desc + `▸ :video_game: **Playcount:** ${playcountString}\n`;
        desc = desc + `▸ :movie_camera: **Replays Watched:** ${replaysWatchedString}\n`;
        desc = desc + `▸ :calendar_spiral: **Joined:** ${joinedString}\n\n`;

        desc = desc + `▸ :first_place: **${MORConfig.DISCORD_BOT_SERVER_NAME} Leaderboard #1s/#2s/#3s (by mod):** ${topsString}\n\n`;

        desc = desc + (dbUser[MORUserKey.AUTOTRACK] ? '' : ':warning: **NOTE:** This user\'s plays are not being automatically tracked!');

        embed.setDescription(desc);
        embed.setThumbnail(dbUser[MORUserKey.PFP_IMAGE_URL]);

        await interaction.editReply({ embeds: [ embed ] });
    }

    /**
     * Add user to database and reply to interaction with added user.
     * @param {ChatInputCommandInteraction<CacheType>} interaction
     * @returns {Promise<void>}
     */
    private async addUserCmd (interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
        const username = interaction.options.getString('username') as string;
        const autotrack = interaction.options.getBoolean('track') as boolean;
        logger.debug(`Bot::addUserCmd - adding user ${username} to database... (track = ${autotrack})`);

        const embed = new EmbedBuilder().setColor(MORConfig.DISCORD_BOT_EMBED_COLOR);

        const osuUser = await this._osu.getUser(username);
        if (!defined(osuUser)) {
            embed.setDescription(`▸ Could not retrieve user "${username}" from osu!`);
            await interaction.editReply({ embeds: [ embed ] });
            return;
        }

        const dbUser: MORUser = {
            [MORUserKey.USER_ID]: osuUser.id,
            [MORUserKey.USERNAME]: osuUser.username,
            [MORUserKey.COUNTRY_CODE]: osuUser.country_code,
            [MORUserKey.GLOBAL_RANK]: osuUser.statistics.global_rank,
            [MORUserKey.PP]: osuUser.statistics.pp,
            [MORUserKey.ACCURACY]: osuUser.statistics.hit_accuracy,
            [MORUserKey.PLAYTIME]: osuUser.statistics.play_time,
            [MORUserKey.PLAYCOUNT]: osuUser.statistics.play_count,
            [MORUserKey.RANKED_SCORE]: osuUser.statistics.ranked_score,
            [MORUserKey.MAX_COMBO]: osuUser.statistics.maximum_combo,
            [MORUserKey.REPLAYS_WATCHED]: osuUser.statistics.replays_watched_by_others,
            [MORUserKey.PFP_IMAGE_URL]: osuUser.avatar_url,
            [MORUserKey.TOP_1S]: 0,
            [MORUserKey.TOP_2S]: 0,
            [MORUserKey.TOP_3S]: 0,
            [MORUserKey.AUTOTRACK]: autotrack
        };

        await this._dbm.insertUser(dbUser);

        // Determine database rank
        let dbUsers = await this._dbm.getUsers();
        dbUsers.sort((a, b) => b[MORUserKey.PP] - a[MORUserKey.PP]);
        dbUsers = dbUsers.filter((u) => u[MORUserKey.AUTOTRACK]);
        const dbIdx = dbUsers.indexOf(dbUsers.find((u) => u[MORUserKey.USERNAME].toLowerCase() === username.toLowerCase()) as MORUser);

        const dbRankString = (dbIdx === -1 ? 'N/A' : `#${(dbIdx + 1).toLocaleString()}`);
        const globalRankString = (isNull(dbUser[MORUserKey.GLOBAL_RANK]) ? 'N/A' : `#${dbUser[MORUserKey.GLOBAL_RANK].toLocaleString()}`);
        const ppString = `${Math.round(dbUser[MORUserKey.PP]).toLocaleString()}pp`;
        const accuracyString = `${Math.round(dbUser[MORUserKey.ACCURACY] * 100) / 100}%`;
        const rankedScoreString = dbUser[MORUserKey.RANKED_SCORE].toLocaleString();
        const totalPlaytimeString = Math.round(dbUser[MORUserKey.PLAYTIME] / 3600).toLocaleString();
        const playcountString = dbUser[MORUserKey.PLAYCOUNT].toLocaleString();
        const replaysWatchedString = dbUser[MORUserKey.REPLAYS_WATCHED].toLocaleString();

        let desc = `▸ :trophy: **${MORConfig.DISCORD_BOT_SERVER_NAME} Rank:** ${dbRankString}\n`;
        desc = desc + `▸ :globe_with_meridians: **Global Rank:** ${globalRankString}\n`;
        desc = desc + `▸ :farmer: **PP:** ${ppString}\n`;
        desc = desc + `▸ :dart: **Accuracy:** ${accuracyString}\n\n`;

        desc = desc + `▸ :fishing_pole_and_fish: **Ranked Score:** ${rankedScoreString}\n`;
        desc = desc + `▸ :stopwatch: **Total Playtime:** ${totalPlaytimeString}\n`;
        desc = desc + `▸ :video_game: **Playcount:** ${playcountString}\n`;
        desc = desc + `▸ :movie_camera: **Replays Watched:** ${replaysWatchedString}\n\n`;

        desc = desc + (dbUser[MORUserKey.AUTOTRACK] ? '' : ':warning: **NOTE:** This user\'s plays are not being automatically tracked!');

        embed.setAuthor({ name: `${MORConfig.DISCORD_BOT_SERVER_NAME} User Added: ${dbUser[MORUserKey.USERNAME]}`, iconURL: MORConfig.DISCORD_BOT_ICON_URL, url: `https://osu.ppy.sh/users/${dbUser[MORUserKey.USER_ID]}` });
        embed.setDescription(desc);
        embed.setThumbnail(dbUser[MORUserKey.PFP_IMAGE_URL]);
        embed.setFooter({ text: `owobot: >track add "${dbUser[MORUserKey.USERNAME]}" | Bathbot: <track "${dbUser[MORUserKey.USERNAME]}"` });

        await interaction.editReply({ embeds: [ embed ] });
    }

    /**
     * Remove user from database and reply to interaction with removed user.
     * @param {ChatInputCommandInteraction<CacheType>} interaction
     * @returns {Promise<void>}
     */
    private async removeUserCmd (interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
        const username = interaction.options.getString('username') as string;
        const removeScores = interaction.options.getBoolean('remove_scores') as boolean;
        logger.debug(`Bot::removeUserCmd - removing user ${username} from database... (removeScores = ${removeScores})`);

        const embed = new EmbedBuilder().setColor(MORConfig.DISCORD_BOT_EMBED_COLOR);
        const dbUsers = await this._dbm.getUsers();
        let dbUser = dbUsers.find((u) => u[MORUserKey.USERNAME].toLowerCase() === username.toLowerCase());
        if (!defined(dbUser)) {
            embed.setDescription(`▸ Could not find user "${username}" in ${MORConfig.DISCORD_BOT_SERVER_NAME} database!`);
            await interaction.editReply({ embeds: [ embed ] });
            return;
        }
        dbUser = dbUser as MORUser;

        await this._dbm.removeUser(dbUser[MORUserKey.USER_ID]);
        if (removeScores) {
            await this._dbm.removeUserScores(dbUser[MORUserKey.USER_ID]);
        }

        const globalRankString = (isNull(dbUser[MORUserKey.GLOBAL_RANK]) ? 'N/A' : `#${dbUser[MORUserKey.GLOBAL_RANK].toLocaleString()}`);
        const ppString = `${Math.round(dbUser[MORUserKey.PP]).toLocaleString()}pp`;
        const accuracyString = `${Math.round(dbUser[MORUserKey.ACCURACY] * 100) / 100}%`;
        const rankedScoreString = dbUser[MORUserKey.RANKED_SCORE].toLocaleString();
        const totalPlaytimeString = Math.round(dbUser[MORUserKey.PLAYTIME] / 3600).toLocaleString();
        const playcountString = dbUser[MORUserKey.PLAYCOUNT].toLocaleString();
        const replaysWatchedString = dbUser[MORUserKey.REPLAYS_WATCHED].toLocaleString();

        let desc = `▸ :globe_with_meridians: **Global Rank:** ${globalRankString}\n`;
        desc = desc + `▸ :farmer: **PP:** ${ppString}\n`;
        desc = desc + `▸ :dart: **Accuracy:** ${accuracyString}\n\n`;

        desc = desc + `▸ :fishing_pole_and_fish: **Ranked Score:** ${rankedScoreString}\n`;
        desc = desc + `▸ :stopwatch: **Total Playtime:** ${totalPlaytimeString}\n`;
        desc = desc + `▸ :video_game: **Playcount:** ${playcountString}\n`;
        desc = desc + `▸ :movie_camera: **Replays Watched:** ${replaysWatchedString}\n\n`;

        embed.setAuthor({ name: `${MORConfig.DISCORD_BOT_SERVER_NAME} User Removed: ${username}`, iconURL: MORConfig.DISCORD_BOT_ICON_URL, url: `https://osu.ppy.sh/users/${dbUser[MORUserKey.USER_ID]}` });
        embed.setDescription(desc);
        embed.setThumbnail(dbUser[MORUserKey.PFP_IMAGE_URL]);
        embed.setFooter({ text: `owobot: >track remove "${dbUser[MORUserKey.USERNAME]}" | Bathbot: <untrack "${dbUser[MORUserKey.USERNAME]}"` });

        await interaction.editReply({ embeds: [ embed ] });
    }

    /**
     * Add score to database and reply to interaction with added score.
     * @param {ChatInputCommandInteraction<CacheType>} interaction
     * @returns {Promise<void>}
     */
    private async addScoreCmd (interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
        const scoreID = interaction.options.getString('score_id') as string;
        logger.debug(`Bot::addScoreCmd - adding score ${scoreID} to database...`);

        const embed = new EmbedBuilder().setColor(MORConfig.DISCORD_BOT_EMBED_COLOR);

        const osuScore = await this._osu.getScore(scoreID);
        if (!defined(osuScore)) {
            embed.setDescription(`▸ Could not retrieve score "${scoreID}" from osu!`);
            await interaction.editReply({ embeds: [ embed ] });
            return;
        }

        const dbScore = await osuScoreToMORScore(this._osu, osuScore);
        await this._dbm.insertScore(dbScore);

        const beatmapString = `[${dbScore[MORScoreKey.BEATMAP]}](https://osu.ppy.sh/scores/osu/${dbScore[MORScoreKey.SCORE_ID]})`;
        const modsString = (dbScore[MORScoreKey.MODS] === '') ? '+NM' : `+${dbScore[MORScoreKey.MODS]}`;
        const starRatingString = `[${Math.round(dbScore[MORScoreKey.STAR_RATING] * 100) / 100}★]`;
        const ppString = `${(Math.round(dbScore[MORScoreKey.PP] * 100) / 100).toLocaleString()}pp`;
        const accuracyString = `${Math.round(dbScore[MORScoreKey.ACCURACY] * 10000) / 100}%`;
        const usernameString = `[${dbScore[MORScoreKey.USERNAME]}](https://osu.ppy.sh/users/${dbScore[MORScoreKey.USER_ID]})`;
        const dateString = new Date(dbScore[MORScoreKey.DATE]).toLocaleDateString();

        let desc = `**${beatmapString} ${modsString}** ${starRatingString}\n`;
        desc = desc + `▸ :farmer: **PP:** ${ppString}\n`;
        desc = desc + `▸ :dart: **Accuracy:** ${accuracyString}\n`;
        desc = desc + `▸ Set by ${usernameString} on ${dateString}\n`;

        embed.setAuthor({ name: `${MORConfig.DISCORD_BOT_SERVER_NAME} Score Added:`, iconURL: MORConfig.DISCORD_BOT_ICON_URL });
        embed.setThumbnail(dbScore[MORScoreKey.BEATMAP_IMAGE_URL]);
        embed.setDescription(desc);

        await interaction.editReply({ embeds: [ embed ] });
    }

    /**
     * Remove score from database and reply to interaction with removed score.
     * @param {ChatInputCommandInteraction<CacheType>} interaction
     * @returns {Promise<void>}
     */
    private async removeScoreCmd (interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
        const scoreID = interaction.options.getString('score_id') as string;
        logger.debug(`Bot::removeScoreCmd - removing score ${scoreID} from database...`);

        const embed = new EmbedBuilder().setColor(MORConfig.DISCORD_BOT_EMBED_COLOR);

        const dbScores = await this._dbm.getScores();
        let dbScore = dbScores.find((s) => s[MORScoreKey.SCORE_ID] === parseInt(scoreID));
        if (!defined(dbScore)) {
            embed.setDescription(`▸ Could not find score ${scoreID} in ${MORConfig.DISCORD_BOT_SERVER_NAME} database!`);
            await interaction.editReply({ embeds: [ embed ] });
            return;
        }
        dbScore = dbScore as MORScore;

        await this._dbm.removeScore(dbScore[MORScoreKey.SCORE_ID], convertOsuMods(modStringToArray(dbScore[MORScoreKey.MODS])));

        const beatmapString = `[${dbScore[MORScoreKey.BEATMAP]}](https://osu.ppy.sh/scores/osu/${dbScore[MORScoreKey.SCORE_ID]})`;
        const modsString = (dbScore[MORScoreKey.MODS] === '') ? '+NM' : `+${dbScore[MORScoreKey.MODS]}`;
        const starRatingString = `[${Math.round(dbScore[MORScoreKey.STAR_RATING] * 100) / 100}★]`;
        const ppString = `${(Math.round(dbScore[MORScoreKey.PP] * 100) / 100).toLocaleString()}pp`;
        const accuracyString = `${Math.round(dbScore[MORScoreKey.ACCURACY] * 10000) / 100}%`;
        const usernameString = `[${dbScore[MORScoreKey.USERNAME]}](https://osu.ppy.sh/users/${dbScore[MORScoreKey.USER_ID]})`;
        const dateString = new Date(dbScore[MORScoreKey.DATE]).toLocaleDateString();

        let desc = `**${beatmapString} ${modsString}** ${starRatingString}\n`;
        desc = desc + `▸ :farmer: **PP:** ${ppString}\n`;
        desc = desc + `▸ :dart: **Accuracy:** ${accuracyString}\n`;
        desc = desc + `▸ Set by ${usernameString} on ${dateString}\n`;

        embed.setAuthor({ name: `${MORConfig.DISCORD_BOT_SERVER_NAME} Score Removed:`, iconURL: MORConfig.DISCORD_BOT_ICON_URL });
        embed.setThumbnail(dbScore[MORScoreKey.BEATMAP_IMAGE_URL]);
        embed.setDescription(desc);

        await interaction.editReply({ embeds: [ embed ] });
    }

    /**
     * Reply to interaction with leaderboard for database scores.
     * @param {ChatInputCommandInteraction<CacheType>} interaction
     * @returns {Promise<void>}
     */
    private async scoresCmd (interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
        let mods = interaction.options.getString('mods');
        const beatmapID = interaction.options.getString('beatmap_id');
        const sortFlag = isNull(interaction.options.getString('sort')) ? 'pp' : interaction.options.getString('sort');
        logger.debug(`Bot::scoresCmd - sending database score leaderboard... (mods = ${mods}, beatmapID = ${beatmapID}, sortFlag = ${sortFlag})`);

        const embed = new EmbedBuilder()
            .setColor(MORConfig.DISCORD_BOT_EMBED_COLOR)
            .setAuthor({ name: `${MORConfig.DISCORD_BOT_SERVER_NAME} Score Leaderboard`, iconURL: MORConfig.DISCORD_BOT_ICON_URL });

        // Filter and sort scores depending on user input
        let scores: MORScore[];
        if (isNull(mods)) {
            scores = await this._dbm.getScores();
        } else {
            try {
                mods = (mods as string).toUpperCase();
                const modKey = convertOsuMods(modStringToArray(mods as string));
                scores = await this._dbm.getTableScores(modKey);
                scores = scores.filter((score) => score[MORScoreKey.MODS] === sortOsuMods(modStringToArray(mods as string)).join().replaceAll(',', ''));
            } catch (error) {
                if (error instanceof TypeError) {
                    embed.setDescription(`▸ ${mods} is not a valid mod combo!`);
                    await interaction.editReply({ embeds: [ embed ] });
                    return;
                } else {
                    throw error;
                }
            }
        }
        if (!isNull(beatmapID)) {
            scores = scores.filter((score) => score[MORScoreKey.BEATMAP_ID].toString() === beatmapID as string);
        }
        if (sortFlag === 'pp') {
            scores.sort((a, b) => b[MORScoreKey.PP] - a[MORScoreKey.PP]);
        } else if (sortFlag === 'accuracy') {
            scores.sort((a, b) => b[MORScoreKey.ACCURACY] - a[MORScoreKey.ACCURACY]);
        } else if (sortFlag === 'star_rating') {
            scores.sort((a, b) => b[MORScoreKey.STAR_RATING] - a[MORScoreKey.STAR_RATING]);
        } else if (sortFlag === 'date_set') {
            scores.sort((a, b) => Date.parse(b[MORScoreKey.DATE]) - Date.parse(a[MORScoreKey.DATE]));
        }

        let currentPage = 1;
        const perPage = 5;
        const numPages = Math.ceil(scores.length / perPage);
        if (numPages === 0) {
            embed.setDescription('▸ No scores found!');
            await interaction.editReply({ embeds: [ embed ] });
            return;
        }

        /**
         * Update scoresCmd embed for given page.
         * @param {number} page
         * @returns {EmbedBuilder}
         */
        const updateEmbed = (page: number): void => {
            if ((page < 1) || (page > numPages)) {
                throw new RangeError(`Bot::scoresCmd::updateEmbed - page must be between 1 and ${numPages}; this should never happen!`);
            }

            // May have to display less than <perPage> scores if on the last page
            const scorePageLimit = ((page === numPages) && (scores.length % perPage)) ? (scores.length % perPage) : perPage;

            let desc = (isNull(mods) ? '' : `\`MODS: ${mods}\`\n`);
            desc = desc + (isNull(beatmapID) ? '' : `\`BEATMAP ID: ${beatmapID}\`\n`);
            desc = desc + `\`SORT BY: ${sortFlag}\`\n\n`;
            for (let i = 0; i < scorePageLimit; ++i) {
                const scoreIdx = perPage * (page - 1) + i;
                const score = scores[scoreIdx] as MORScore;

                const beatmapString = `[${score[MORScoreKey.BEATMAP]}](https://osu.ppy.sh/scores/osu/${score[MORScoreKey.SCORE_ID]})`;
                const modString = (score[MORScoreKey.MODS] === '') ? '+NM' : `+${score[MORScoreKey.MODS]}`;
                const starRatingString = `[${Math.round(score[MORScoreKey.STAR_RATING] * 100) / 100}★]`;
                const ppString = `${isNull(score[MORScoreKey.PP]) ? '0' : (Math.round(score[MORScoreKey.PP] * 100) / 100).toLocaleString()}pp`;
                const accuracyString = `${Math.round(score[MORScoreKey.ACCURACY] * 10000) / 100}%`;
                const usernameString = `[${score[MORScoreKey.USERNAME]}](https://osu.ppy.sh/users/${score[MORScoreKey.USER_ID]})`;
                const dateString = new Date(score[MORScoreKey.DATE]).toLocaleDateString();
                const lineString = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';

                desc = desc + `**${scoreIdx + 1}.** ${beatmapString} **${modString}** ${starRatingString}\n`;
                desc = desc + `▸ :farmer: **PP:** ${ppString}\n`;
                desc = desc + `▸ :dart: **Accuracy:** ${accuracyString}\n`;
                desc = desc + `▸ Set by ${usernameString} on ${dateString}\n`;
                if (i !== scorePageLimit - 1) {
                    desc = desc + `${lineString}\n`;
                }
            }

            const scorePfpIdx = perPage * (page - 1);
            const beatmapImageURL = (scores[scorePfpIdx] as MORScore)[MORScoreKey.BEATMAP_IMAGE_URL];

            embed.setThumbnail(beatmapImageURL);
            embed.setDescription(desc);
        };

        updateEmbed(currentPage);

        // Use date as hash for button IDs
        const buttonHash = new Date(Date.now()).toISOString();
        const buttons = new ActionRowBuilder<ButtonBuilder>()
            .addComponents([
                new ButtonBuilder()
                    .setCustomId(`Scores_start_${buttonHash}`)
                    .setLabel('◀◀')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`Scores_prev_${buttonHash}`)
                    .setLabel('◀')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`Scores_next_${buttonHash}`)
                    .setLabel('▶')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(numPages === 1),
                new ButtonBuilder()
                    .setCustomId(`Scores_last_${buttonHash}`)
                    .setLabel('▶▶')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(numPages === 1)
            ]);

        /**
         * Update buttons for embed.
         * @param {Interaction<CacheType>} interaction
         * @returns {Promise<void>}
         */
        const updateButtons = async (interaction: Interaction<CacheType>): Promise<void> => {
            if (!interaction.isButton()) {
                return;
            }

            const buttonID = interaction.customId;
            logger.debug(`Bot::scoresCmd::updateButtons - button "${buttonID}" was pressed`);

            if (buttonID === `Scores_start_${buttonHash}`) {
                currentPage = 1;
                (buttons.components[0] as ButtonBuilder).setDisabled(true);
                (buttons.components[1] as ButtonBuilder).setDisabled(true);
                (buttons.components[2] as ButtonBuilder).setDisabled(false);
                (buttons.components[3] as ButtonBuilder).setDisabled(false);
            } else if (buttonID === `Scores_prev_${buttonHash}`) {
                currentPage--;
                (buttons.components[0] as ButtonBuilder).setDisabled(currentPage === 1);
                (buttons.components[1] as ButtonBuilder).setDisabled(currentPage === 1);
                (buttons.components[2] as ButtonBuilder).setDisabled(false);
                (buttons.components[3] as ButtonBuilder).setDisabled(false);
            } else if (buttonID === `Scores_next_${buttonHash}`) {
                currentPage++;
                (buttons.components[0] as ButtonBuilder).setDisabled(false);
                (buttons.components[1] as ButtonBuilder).setDisabled(false);
                (buttons.components[2] as ButtonBuilder).setDisabled(currentPage === numPages);
                (buttons.components[3] as ButtonBuilder).setDisabled(currentPage === numPages);
            } else if (buttonID === `Scores_last_${buttonHash}`) {
                currentPage = numPages;
                (buttons.components[0] as ButtonBuilder).setDisabled(false);
                (buttons.components[1] as ButtonBuilder).setDisabled(false);
                (buttons.components[2] as ButtonBuilder).setDisabled(true);
                (buttons.components[3] as ButtonBuilder).setDisabled(true);
            } else {
                return;
            }

            updateEmbed(currentPage);
            await interaction.update({ embeds: [ embed ], components: [ buttons ] });
        };

        // Listen for button presses for 60 seconds
        logger.debug('Bot::scoresCmd - listening for button presses...');
        this._discord.on('interactionCreate', updateButtons);
        setTimeout(() => {
            logger.debug('Bot::scoresCmd - no longer listening for button presses!');
            this._discord.off('interactionCreate', updateButtons);
            interaction.editReply({ embeds: [ embed ], components: [] });
        }, 60000);

        await interaction.editReply({ embeds: [ embed ], components: [ buttons ] });
        return;
    }
}
