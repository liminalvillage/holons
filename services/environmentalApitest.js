import { jest } from '@jest/globals';

// Mock axios before importing the modules that use it
jest.mock('axios', () => ({
    default: {
        get: jest.fn()
    }
}));

// Import axios after mocking
import axios from 'axios';

// Import the API functions
import {
    getCarbonSequestration,
    getSoilCarbon,
    getBiodiversityData,
    getVegetationCover,
    getAirQuality,
    getWaterRetention,
    getDeforestationData,
    getFloodRisk,
    getFoodSecurity,
    getEmploymentRate,
    getTransparencyScore,
    getBlockchainTransactions,
    getCircularEconomyData,
    getRenewableEnergyData,
    getClimateChangeData
} from './environmentalApi.js';

describe('Environmental API Tests', () => {
    // Increase timeout for real API calls
    jest.setTimeout(60000);

    const ROME_LAT = 41.9;
    const ROME_LON = 12.5;
    const COUNTRY_CODE = 'ITA';
    const ETH_ADDRESS = '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe';

    test('getCarbonSequestration returns NASA POWER data', async () => {
        const result = await getCarbonSequestration(ROME_LAT, ROME_LON);
        expect(result).not.toBeNull();
        expect(result.messages).toBeDefined();
        expect(result.parameters).toBeDefined();
        expect(result.parameters).toHaveProperty('T2M');
        expect(result.parameters).toHaveProperty('PRECTOT');
    });

    test('getSoilCarbon returns ISRIC soil data', async () => {
        const result = await getSoilCarbon(ROME_LAT, ROME_LON);
        expect(result).not.toBeNull();
        expect(result.properties).toBeDefined();
        expect(result.properties.soc).toBeDefined();
    });

    test('getBiodiversityData returns GBIF data', async () => {
        const result = await getBiodiversityData(COUNTRY_CODE);
        expect(result).not.toBeNull();
        expect(result.count).toBeDefined();
        expect(result.results).toBeDefined();
        expect(Array.isArray(result.results)).toBeTruthy();
    });

    test('getVegetationCover returns MODIS NDVI data', async () => {
        const result = await getVegetationCover(ROME_LAT, ROME_LON);
        expect(result).not.toBeNull();
        expect(result.subset || result.data).toBeDefined();
    });

    test('getAirQuality returns OpenWeather data', async () => {
        const result = await getAirQuality(ROME_LAT, ROME_LON);
        expect(result).not.toBeNull();
        expect(result.list).toBeDefined();
        expect(result.list[0].main).toBeDefined();
        expect(result.list[0].components).toBeDefined();
    });

    test('getWaterRetention returns USGS data', async () => {
        const result = await getWaterRetention(ROME_LAT, ROME_LON);
        expect(result).not.toBeNull();
        expect(result.value || result.timeSeries).toBeDefined();
    });

    test('getDeforestationData returns World Bank forest data', async () => {
        const result = await getDeforestationData(COUNTRY_CODE);
        expect(result).not.toBeNull();
        expect(Array.isArray(result)).toBeTruthy();
        if (result.length > 1) {
            expect(result[1][0]).toHaveProperty('indicator');
            expect(result[1][0].indicator.id).toBe('AG.LND.FRST.ZS');
        }
    });

    test('getFloodRisk returns USGS gauge data', async () => {
        const result = await getFloodRisk(ROME_LAT, ROME_LON);
        expect(result).not.toBeNull();
        expect(result.value || result.timeSeries).toBeDefined();
    });

    test('getFoodSecurity returns World Bank data', async () => {
        const result = await getFoodSecurity(COUNTRY_CODE);
        expect(result).not.toBeNull();
        expect(Array.isArray(result)).toBeTruthy();
        if (result.length > 1) {
            expect(result[1][0]).toHaveProperty('indicator');
            expect(result[1][0].indicator.id).toBe('SN.ITK.DEFC.ZS');
        }
    });

    test('getEmploymentRate returns World Bank data', async () => {
        const result = await getEmploymentRate(COUNTRY_CODE);
        expect(result).not.toBeNull();
        expect(Array.isArray(result)).toBeTruthy();
        if (result.length > 1) {
            expect(result[1][0]).toHaveProperty('indicator');
            expect(result[1][0].indicator.id).toBe('SL.EMP.TOTL.SP.ZS');
        }
    });

    test('getTransparencyScore returns World Bank governance data', async () => {
        const result = await getTransparencyScore(COUNTRY_CODE);
        expect(result).not.toBeNull();
        expect(Array.isArray(result)).toBeTruthy();
        if (result.length > 1) {
            expect(result[1][0]).toHaveProperty('indicator');
            expect(result[1][0].indicator.id).toBe('GE.EST');
        }
    });

    test('getBlockchainTransactions returns Etherscan data', async () => {
        const result = await getBlockchainTransactions(ETH_ADDRESS);
        expect(result).not.toBeNull();
        expect(result.status).toBeDefined();
        expect(result.result).toBeDefined();
        expect(Array.isArray(result.result)).toBeTruthy();
    });

    test('getCircularEconomyData returns World Bank emissions data', async () => {
        const result = await getCircularEconomyData(COUNTRY_CODE);
        expect(result).not.toBeNull();
        expect(Array.isArray(result)).toBeTruthy();
        if (result.length > 1) {
            expect(result[1][0]).toHaveProperty('indicator');
            expect(result[1][0].indicator.id).toBe('EN.ATM.GHGT.KT.CE');
        }
    });

    test('getRenewableEnergyData returns World Bank energy data', async () => {
        const result = await getRenewableEnergyData(COUNTRY_CODE);
        expect(result).not.toBeNull();
        expect(Array.isArray(result)).toBeTruthy();
        if (result.length > 1) {
            expect(result[1][0]).toHaveProperty('indicator');
            expect(result[1][0].indicator.id).toBe('EG.FEC.RNEW.ZS');
        }
    });

    test('getClimateChangeData returns NOAA data', async () => {
        const result = await getClimateChangeData(ROME_LAT, ROME_LON);
        expect(result).not.toBeNull();
        expect(result.metadata || result.results).toBeDefined();
    });
}); 