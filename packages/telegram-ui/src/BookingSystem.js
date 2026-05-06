/**
 * @fileoverview JSON-configurable booking/application system.
 * @module src/BookingSystem
 */

import { Scenes, Markup } from 'telegraf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import SingleSelectScene from '../utils/SingleSelectScene.js';
import MultiSelectScene from '../utils/MultiSelectScene.js';
import TextAreaScene from '../utils/TextAreaScene.js';
import SectionScene from '../utils/SectionScene.js';
import DatePickerScene from '../utils/DatePickerScene.js';
import InputScene from '../utils/InputScene.js';
import NotificationService from '../utils/NotificationService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * JSON-configurable booking/application system.
 *
 * @class BookingSystem
 * @description Orchestrates a configurable booking form flow using JSON configuration.
 * Generates scenes dynamically and handles navigation, data storage, and admin notifications.
 *
 * @property {Object} bot - Telegraf bot instance
 * @property {Object} db - Database instance (Gun)
 * @property {Object} config - Loaded booking configuration from JSON
 * @property {Array} scenes - Generated Telegraf scenes
 * @property {NotificationService} notificationService - Admin notification handler
 *
 * @example
 * const bookingSystem = new BookingSystem(bot, db, './data/booking.json');
 * // User enters /apply to begin the application
 */
export default class BookingSystem {
    /**
     * Create a new BookingSystem
     * @param {Object} bot - Telegraf bot instance
     * @param {Object} db - Database instance
     * @param {string} configPath - Path to booking.json configuration file
     */
    constructor(bot, db, configPath = './data/booking.json') {
        this.bot = bot;
        this.db = db;
        this.config = null;
        this.scenes = [];
        this.sceneMap = new Map();

        // Initialize primitive scene utilities (they register themselves)
        this.initializePrimitives();

        // Load configuration
        this.loadConfig(configPath);

        if (this.config) {
            // Initialize notification service
            this.notificationService = new NotificationService(bot, this.config);

            // Generate and register scenes
            this.generateScenes();
            this.registerScenes();
            this.registerCommand();
        }
    }

    /**
     * Initialize primitive scene utilities
     */
    initializePrimitives() {
        // These utilities register their scenes with the bot's stage
        new InputScene(this.bot);
        new SingleSelectScene(this.bot);
        new MultiSelectScene(this.bot);
        new TextAreaScene(this.bot);
        new SectionScene(this.bot);
        new DatePickerScene(this.bot);
    }

    /**
     * Load booking configuration from JSON file
     * @param {string} configPath - Path to configuration file
     */
    loadConfig(configPath) {
        try {
            // Resolve path relative to project root
            const fullPath = path.resolve(process.cwd(), configPath);

            if (!fs.existsSync(fullPath)) {
                console.warn(`BookingSystem: Configuration file not found at ${fullPath}`);
                return;
            }

            const configData = fs.readFileSync(fullPath, 'utf8');
            this.config = JSON.parse(configData);
            console.log(`BookingSystem: Loaded configuration from ${fullPath}`);
        } catch (error) {
            console.error('BookingSystem: Error loading configuration:', error.message);
        }
    }

    /**
     * Generate all scenes from configuration
     */
    generateScenes() {
        // Create entry scene
        const entryScene = this.createEntryScene();
        this.scenes.push(entryScene);

        // Create scenes for each field in the config
        this.config.sections.forEach((field, index) => {
            const scene = this.createSceneForField(field, index);
            if (scene) {
                this.scenes.push(scene);
                this.sceneMap.set(field.id, scene);
            }
        });

        // Create completion scene
        const completionScene = this.createCompletionScene();
        this.scenes.push(completionScene);
    }

    /**
     * Create the entry scene for the booking flow
     * @returns {Scenes.BaseScene} Entry scene
     */
    createEntryScene() {
        const scene = new Scenes.BaseScene('booking_entry');

        scene.enter(async (ctx) => {
            try {
                // Initialize booking session
                ctx.session.booking = {
                    data: {},
                    startedAt: new Date().toISOString()
                };

                // Build sequence from config sections
                ctx.session.bookingSequence = this.config.sections.map(s => `booking_${s.id}`);
                ctx.session.bookingStage = 0;

                // Send welcome message
                const { title, description } = this.config.metadata || {};
                const welcomeTitle = title || 'Application Form';
                const welcomeDesc = description || 'Please complete the following form.';

                await ctx.reply(
                    `📋 *${this.escapeMarkdown(welcomeTitle)}*\n\n${this.escapeMarkdown(welcomeDesc)}`,
                    { parse_mode: 'Markdown' }
                );

                // Notify admins if configured
                if (this.config.metadata?.adminNotification?.notifyOnStart) {
                    await this.notificationService.notifyAdmins('application_started', {}, ctx);
                }

                // Move to first field
                return ctx.scene.enter(ctx.session.bookingSequence[0]);

            } catch (error) {
                console.error('BookingSystem entry error:', error);
                await ctx.reply('An error occurred. Please try again with /apply');
                return ctx.scene.leave();
            }
        });

        return scene;
    }

    /**
     * Create a scene for a specific field from configuration
     * @param {Object} field - Field configuration
     * @param {number} index - Field index in sections array
     * @returns {Scenes.BaseScene|null} Generated scene or null
     */
    createSceneForField(field, index) {
        const sceneId = `booking_${field.id}`;

        switch (field.type) {
            case 'section':
                return this.createSectionFieldScene(sceneId, field);
            case 'text':
                return this.createTextFieldScene(sceneId, field);
            case 'textarea':
                return this.createTextAreaFieldScene(sceneId, field);
            case 'single_select':
                return this.createSingleSelectFieldScene(sceneId, field);
            case 'multi_select':
                return this.createMultiSelectFieldScene(sceneId, field);
            case 'date':
                return this.createDateFieldScene(sceneId, field);
            default:
                console.warn(`BookingSystem: Unknown field type "${field.type}" for field "${field.id}"`);
                return null;
        }
    }

    /**
     * Create a section display scene
     */
    createSectionFieldScene(sceneId, field) {
        const scene = new Scenes.BaseScene(sceneId);

        scene.enter(async (ctx) => {
            ctx.scene.enter('section_scene', {
                title: field.title,
                description: field.description,
                icon: field.icon || '📌',
                image: field.image,
                onContinue: async (sectionCtx) => {
                    this.advanceToNextField(sectionCtx);
                }
            });
        });

        return scene;
    }

    /**
     * Create a text input scene
     */
    createTextFieldScene(sceneId, field) {
        const scene = new Scenes.BaseScene(sceneId);

        scene.enter(async (ctx) => {
            ctx.scene.enter('input_scene', {
                promptText: field.prompt || `Please enter your ${field.label}:`,
                inputType: field.inputType || 'text',
                allowEmpty: !field.required,
                validate: field.validation ? (input) => {
                    if (field.validation.pattern) {
                        const regex = new RegExp(field.validation.pattern);
                        if (!regex.test(input)) {
                            return { valid: false, error: field.validation.errorMessage || 'Invalid format' };
                        }
                    }
                    return { valid: true };
                } : null,
                showCancelButton: !field.required,
                onComplete: async (inputCtx, value) => {
                    await this.saveFieldData(inputCtx, field.storageKey || field.id, value);
                    this.advanceToNextField(inputCtx);
                },
                onCancel: async (inputCtx) => {
                    if (!field.required) {
                        this.advanceToNextField(inputCtx);
                    }
                }
            });
        });

        return scene;
    }

    /**
     * Create a textarea scene
     */
    createTextAreaFieldScene(sceneId, field) {
        const scene = new Scenes.BaseScene(sceneId);

        scene.enter(async (ctx) => {
            ctx.scene.enter('textarea_scene', {
                prompt: field.prompt || `Please enter your ${field.label}:`,
                minLength: field.validation?.minLength,
                maxLength: field.validation?.maxLength,
                allowEmpty: !field.required,
                showCancelButton: !field.required,
                onComplete: async (inputCtx, value) => {
                    await this.saveFieldData(inputCtx, field.storageKey || field.id, value);
                    this.advanceToNextField(inputCtx);
                },
                onCancel: async (inputCtx) => {
                    if (!field.required) {
                        this.advanceToNextField(inputCtx);
                    }
                }
            });
        });

        return scene;
    }

    /**
     * Create a single-select scene
     */
    createSingleSelectFieldScene(sceneId, field) {
        const scene = new Scenes.BaseScene(sceneId);

        scene.enter(async (ctx) => {
            ctx.scene.enter('single_select_scene', {
                prompt: field.prompt || `Please select your ${field.label}:`,
                options: field.options,
                allowOther: field.allowOther,
                otherPrompt: field.otherPrompt || `Please specify your ${field.label}:`,
                showInfoButtons: field.infoButtons?.enabled,
                infoDescriptions: field.infoButtons?.descriptions,
                showCancelButton: !field.required,
                onComplete: async (selectCtx, result) => {
                    await this.saveFieldData(selectCtx, field.storageKey || field.id, result);
                    this.advanceToNextField(selectCtx);
                },
                onCancel: async (selectCtx) => {
                    if (!field.required) {
                        this.advanceToNextField(selectCtx);
                    }
                }
            });
        });

        return scene;
    }

    /**
     * Create a multi-select scene
     */
    createMultiSelectFieldScene(sceneId, field) {
        const scene = new Scenes.BaseScene(sceneId);

        scene.enter(async (ctx) => {
            ctx.scene.enter('multi_select_scene', {
                prompt: field.prompt || `Please select your ${field.label} (choose all that apply):`,
                options: field.options,
                allowOther: field.allowOther,
                otherPrompt: field.otherPrompt || `Please specify your ${field.label}:`,
                itemsPerPage: field.pagination?.itemsPerPage || 4,
                minSelections: field.required ? 1 : 0,
                maxSelections: field.maxSelections,
                showCancelButton: !field.required,
                onComplete: async (selectCtx, selectedValues) => {
                    await this.saveFieldData(selectCtx, field.storageKey || field.id, selectedValues);
                    this.advanceToNextField(selectCtx);
                },
                onCancel: async (selectCtx) => {
                    if (!field.required) {
                        this.advanceToNextField(selectCtx);
                    }
                }
            });
        });

        return scene;
    }

    /**
     * Create a date picker scene
     */
    createDateFieldScene(sceneId, field) {
        const scene = new Scenes.BaseScene(sceneId);

        scene.enter(async (ctx) => {
            ctx.scene.enter('date_picker_scene', {
                prompt: field.prompt || `Please select your ${field.label}:`,
                dateConfig: field.dateConfig,
                onComplete: async (dateCtx, dateValue) => {
                    await this.saveFieldData(dateCtx, field.storageKey || field.id, dateValue);
                    this.advanceToNextField(dateCtx);
                }
            });
        });

        return scene;
    }

    /**
     * Create the completion scene
     * @returns {Scenes.BaseScene} Completion scene
     */
    createCompletionScene() {
        const scene = new Scenes.BaseScene('booking_complete');

        scene.enter(async (ctx) => {
            try {
                const applicationData = ctx.session.booking?.data || {};

                // Save complete application to database
                await this.saveApplication(ctx, applicationData);

                // Send admin notification
                await this.notificationService.notifyAdmins('application_submitted', applicationData, ctx);

                // Show completion message
                const completionTitle = this.config.metadata?.completionTitle || 'Application Submitted';
                const completionMessage = this.config.metadata?.completionMessage ||
                    'Thank you for your application! We will review it and get back to you soon.';

                await ctx.reply(
                    `✅ *${this.escapeMarkdown(completionTitle)}*\n\n${this.escapeMarkdown(completionMessage)}`,
                    { parse_mode: 'Markdown' }
                );

                // Clean up session
                delete ctx.session.booking;
                delete ctx.session.bookingSequence;
                delete ctx.session.bookingStage;

                return ctx.scene.leave();

            } catch (error) {
                console.error('BookingSystem completion error:', error);
                await ctx.reply('Your application has been received. Thank you!');
                return ctx.scene.leave();
            }
        });

        return scene;
    }

    /**
     * Advance to the next field in the booking sequence
     * @param {Object} ctx - Telegraf context
     */
    advanceToNextField(ctx) {
        ctx.session.bookingStage += 1;

        if (ctx.session.bookingStage >= ctx.session.bookingSequence.length) {
            return ctx.scene.enter('booking_complete');
        }

        return ctx.scene.enter(ctx.session.bookingSequence[ctx.session.bookingStage]);
    }

    /**
     * Save field data to session and database
     * @param {Object} ctx - Telegraf context
     * @param {string} fieldId - Field identifier
     * @param {any} value - Field value
     */
    async saveFieldData(ctx, fieldId, value) {
        // Store in session
        if (!ctx.session.booking) {
            ctx.session.booking = { data: {} };
        }
        ctx.session.booking.data[fieldId] = value;
    }

    /**
     * Save complete application to database
     * @param {Object} ctx - Telegraf context
     * @param {Object} data - Application data
     */
    async saveApplication(ctx, data) {
        try {
            const userId = ctx.from.id.toString();
            const storagePrefix = this.config.settings?.storagePrefix || 'applications';
            const timestamp = Date.now();

            const application = {
                status: 'submitted',
                submittedAt: new Date().toISOString(),
                userId: userId,
                username: ctx.from.username || null,
                firstName: ctx.from.first_name || null,
                lastName: ctx.from.last_name || null,
                data: data
            };

            // Save to Gun DB
            if (ctx.session.db) {
                await ctx.session.db.gun
                    .get(userId)
                    .get(storagePrefix)
                    .get(timestamp.toString())
                    .put(JSON.stringify(application));
            }

            console.log(`BookingSystem: Application saved for user ${userId}`);

        } catch (error) {
            console.error('BookingSystem: Error saving application:', error);
        }
    }

    /**
     * Register all generated scenes with the bot
     */
    registerScenes() {
        this.scenes.forEach(scene => {
            this.bot.stage.register(scene);
        });
        console.log(`BookingSystem: Registered ${this.scenes.length} scenes`);
    }

    /**
     * Register the /apply command
     */
    registerCommand() {
        const commandName = this.config.settings?.command || 'apply';

        this.bot.command(commandName, (ctx) => {
            ctx.session.db = this.db;
            ctx.scene.enter('booking_entry');
        });

        console.log(`BookingSystem: Registered /${commandName} command`);
    }

    /**
     * Escape Markdown special characters
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    escapeMarkdown(text) {
        if (!text) return '';
        return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
    }
}
