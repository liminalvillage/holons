import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const logError = (service, error) => {
    const status = error.response?.status;
    const message = error.response?.data?.message || error.message;
    console.error(`${service} API Error:`, { status, message });
};

/**
 * Fetch Carbon Sequestration Data (Using NASA POWER API)
 */
export async function getCarbonSequestration(lat = 41.9, lon = 12.5) {
    try {
        const response = await axios.default.get(
            `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,PRECTOT,PS,WS2M&community=RE&longitude=${lon}&latitude=${lat}&start=20230101&end=20231231&format=JSON`
        );
        return response.data;
    } catch (error) {
        logError('Carbon Sequestration', error);
        return null;
    }
}

/**
 * Fetch Soil Carbon Data (Using ISRIC World Soil Information)
 */
export async function getSoilCarbon(lat = 41.9, lon = 12.5) {
    try {
        const response = await axios.default.get(
            `https://rest.isric.org/soilgrids/v2.0/properties/query?lat=${lat}&lon=${lon}&property=soc&depth=0-30cm&value=mean`
        );
        return response.data;
    } catch (error) {
        logError('Soil Carbon', error);
        return null;
    }
}

/**
 * Fetch Biodiversity Data (GBIF API)
 */
export async function getBiodiversityData(countryCode = "ITA") {
    try {
        const response = await axios.default.get(`https://api.gbif.org/v1/occurrence/search?country=${countryCode}&limit=100`);
        return response.data;
    } catch (error) {
        logError('Biodiversity', error);
        return null;
    }
}

/**
 * Fetch Vegetation Cover Data (Using NASA MODIS Vegetation Index)
 */
export async function getVegetationCover(lat = 41.9, lon = 12.5) {
    try {
        const response = await axios.default.get(
            `https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset?latitude=${lat}&longitude=${lon}&band=NDVI&startDate=2023-01-01&endDate=2023-12-31`,
            {
                headers: {
                    'Accept': 'application/json'
                }
            }
        );
        return response.data;
    } catch (error) {
        logError('Vegetation Cover', error);
        return null;
    }
}

/**
 * Fetch Air Quality Data (OpenWeather API)
 */
export async function getAirQuality(lat = 41.9, lon = 12.5) {
    try {
        const response = await axios.default.get(
            `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${process.env.OPENWEATHER_API_KEY}`
        );
        return response.data;
    } catch (error) {
        logError('Air Quality', error);
        return null;
    }
}

/**
 * Fetch Water Retention Data (Using USGS Water Services)
 */
export async function getWaterRetention(lat = 41.9, lon = 12.5) {
    try {
        const response = await axios.default.get(
            `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=11447650&siteStatus=active`,
            {
                headers: {
                    'Accept': 'application/json'
                }
            }
        );
        return response.data;
    } catch (error) {
        logError('Water Retention', error);
        return null;
    }
}

/**
 * Fetch Deforestation Data (Using World Bank Forest Data)
 */
export async function getDeforestationData(countryCode = "ITA") {
    try {
        const response = await axios.default.get(
            `https://api.worldbank.org/v2/country/${countryCode}/indicator/AG.LND.FRST.ZS?format=json`
        );
        return response.data;
    } catch (error) {
        logError('Deforestation', error);
        return null;
    }
}

/**
 * Fetch Flood Risk Data (Using USGS Water Services)
 */
export async function getFloodRisk(lat = 41.9, lon = 12.5) {
    try {
        const response = await axios.default.get(
            `https://waterservices.usgs.gov/nwis/iv/?format=json&stateCd=CA&parameterCd=00065&siteStatus=active`,
            {
                headers: {
                    'Accept': 'application/json'
                }
            }
        );
        return response.data;
    } catch (error) {
        logError('Flood Risk', error);
        return null;
    }
}

/**
 * Fetch Food Security Data (World Bank API)
 */
export async function getFoodSecurity(countryCode = "ITA") {
    try {
        const response = await axios.default.get(
            `https://api.worldbank.org/v2/country/${countryCode}/indicator/SN.ITK.DEFC.ZS?format=json`
        );
        return response.data;
    } catch (error) {
        logError('Food Security', error);
        return null;
    }
}

/**
 * Fetch Local Employment Rate (World Bank API)
 */
export async function getEmploymentRate(countryCode = "ITA") {
    try {
        const response = await axios.default.get(
            `https://api.worldbank.org/v2/country/${countryCode}/indicator/SL.EMP.TOTL.SP.ZS?format=json`
        );
        return response.data;
    } catch (error) {
        logError('Employment Rate', error);
        return null;
    }
}

/**
 * Fetch Governance Score (World Bank API)
 */
export async function getTransparencyScore(countryCode = "ITA") {
    try {
        const response = await axios.default.get(
            `https://api.worldbank.org/v2/country/${countryCode}/indicator/GE.EST?format=json`
        );
        return response.data;
    } catch (error) {
        logError('Transparency Score', error);
        return null;
    }
}

/**
 * Fetch Blockchain Transactions (Etherscan API)
 */
export async function getBlockchainTransactions(address = "0x0000000000000000000000000000000000000000") {
    try {
        const response = await axios.default.get(
            `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${process.env.ETHERSCAN_API_KEY}`
        );
        return response.data;
    } catch (error) {
        logError('Blockchain Transactions', error);
        return null;
    }
}

/**
 * Fetch Circular Economy Data (Using World Bank Development Indicators)
 */
export async function getCircularEconomyData(countryCode = "ITA") {
    try {
        const response = await axios.default.get(
            `https://api.worldbank.org/v2/country/${countryCode}/indicator/EN.ATM.GHGT.KT.CE?format=json`
        );
        return response.data;
    } catch (error) {
        logError('Circular Economy', error);
        return null;
    }
}

/**
 * Fetch Renewable Energy Data (World Bank API)
 */
export async function getRenewableEnergyData(countryCode = "ITA") {
    try {
        const response = await axios.default.get(
            `https://api.worldbank.org/v2/country/${countryCode}/indicator/EG.FEC.RNEW.ZS?format=json`
        );
        return response.data;
    } catch (error) {
        logError('Renewable Energy', error);
        return null;
    }
}

/**
 * Fetch Climate Change Data (NOAA Climate API)
 */
export async function getClimateChangeData(lat = 41.9, lon = 12.5) {
    try {
        const response = await axios.default.get(
            `https://www.ncdc.noaa.gov/cdo-web/api/v2/data?datasetid=GHCND&latitude=${lat}&longitude=${lon}&startdate=2023-01-01&enddate=2023-12-31&limit=1000`,
            {
                headers: {
                    'token': process.env.NOAA_API_KEY
                }
            }
        );
        return response.data;
    } catch (error) {
        logError('Climate Change', error);
        return null;
    }
} 