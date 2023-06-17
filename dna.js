import 'values.js'
import { Markup } from 'telegraf'

export async function value(ctx, orbitdb) {
    
}


const dna =
{
    "Open to visitors": [
    "Yes",
    "Yes, rarely",
    "No"
    ],
    "Open to new members": [
    "Yes",
    "Not currently, but there is a list or future possibility",
    "No"
    ],
    "Community forming status": [
    "Established",
    "Forming",
    "Re-forming",
    "Disbanded"
    ],
    "Housing Access": [
    "Purchase",
    "Rental",
    "Work-exchange",
    "Included in Membership"
    ],
    "City": [],
    "State/Province (outside the US)": [],
    "Rural/Urban/Etc": [
    "Rural",
    "Urban",
    "Suburban",
    "Small Town or Village",
    "Mobile",
    "To be Determined"
    ],
    "Community Type(s)": [
    "Commune (organized around sharing almost everything.)",
    "Ecovillage (organized around ecology and sustainability.)",
    "Cohousing (individual homes within group owned property.)",
    "Shared Housing (multiple individuals sharing a dwelling.)",
    "Student Housing or Student Co-Op",
    "Spiritual or Religious Community",
    "Unspecified, or Other",
    "Transition Town or Eco-Neighborhood",
    "Traditional or Indigenous Community"
    ],
    "Dietary Preferences": [
    "Omnivorous (plants and animals)",
    "Paleo (no grains, dairy, processed foods, or legumes)",
    "Local (food sourced within 150 miles)",
    "Organic (no pesticides or synthetic fertilizers)",
    "GMO Free (only non-genetically modified organisms)",
    "Vegetarian Only",
    "Mostly Vegetarian",
    "Vegan Only",
    "Mostly Vegan",
    "Opportunivore (dumpster diving, nature harvesting, etc.)",
    "Raw or Mostly Raw",
    "Kosher",
    "Halal",
    "Dairy-Free",
    "Gluten-Free"
    ],
    "Education Styles": [
    "Home Schooling",
    "Private Schooling at the Community",
    "Private School off the property",
    "Public Schooling",
    "Up to each individual"
    ],
    "Shared religious/spiritual practice(s)": [
    "Ecumenical (accepts all religions or spiritual practices)",
    "Eclectic (integrates multiple religious or spiritual beliefs)",
    "Not a particularly spiritual or religious Community",
    "Christian",
    "Buddhist",
    "Jewish",
    "Muslim",
    "Hindu",
    "Wiccan",
    "Protestant",
    "Lutheran",
    "Catholic",
    "Emissaries",
    "Quaker",
    "Sufi",
    "Native American",
    "Hutterian Brethren",
    "Unitarian Universalist",
    "Paganism or Earth Religions",
    "Mixed Eastern Philosophy or Practice",
    "Hare Krishna",
    "Rainbow Family",
    "Ananda Community",
    "Hare Krishna",
    "Bahai",
    "Atheist",
    "Agnostic",
    "Humanist",
    "Jedi",
    "Other"
    ],
    "Decision making method": [
    "Consensus (everyone agrees)",
    "Modified Consensus (everyone agrees, with some exceptions or fallbacks.)",
    "Voting (majority or super-majority rule)",
    "By a board, council, group of elders, or leadership group",
    "By an individual community leader",
    "Sociocracy",
    "Holocracy",
    "Anarchy"],
"Percentage of food currently produced": [
"0%, or close to 0%",
"Up to 25%",
"Between 25-50%",
"From 50-75%",
"Almost All, up to 90%",
"100%"
],
"Percentage of local (within 150 miles) food": [
"0%, or close to 0%",
"Up to 25%",
"Between 25-50%",
"From 50-75%",
"Almost All, up to 90%",
"100%"
],
"Percentage of renewable energy currently generated": [
"0%, or close to 0%",
"Up to 25%",
"25-50%",
"50-75%",
"Almost All, up to 90%",
"100%",
"Determined by Individuals or Households."
],
"Energy Sources": [
"Connected to the Grid",
"Solar",
"Wind",
"Hydro-Electric",
"Biomass",
"Biogas",
"Biofuel",
"Geothermal",
"Other"
],
"Community land owner": [
"Individual community member(s)",
"A subgroup of community members",
"The entire community membership",
"Multiple stakeholders"
],
"Community Network or Organization Affiliations": [
"The Fellowship for Intentional Community",
"Federation of Egalitarian Communities",
"Global Ecovillage Network",
"Coho/US",
"Ecovillage Network of the Americas",
"ICC - Michigan",
"ICC - Texas",
"Madison Community Cooperatives",
"Michigan State University Student Housing Corporation",
"Northwest Intentional Communities Association",
"Camphill Association of North America",
"Catholic Worker",
"Hutterian Brethren",
"Rainbow Family",
"Twelve Tribes",
"Utopian EcoVillage Network Federation",
"Kollektivhus NU",
"Valhalla"
],
"Percentage of shared income": [
"None",
"All or close to all",
"Partial share of income"
],
"Dues, Fees or Shared Expenses?": [
"Yes",
"No"
],
"Alcohol Use": [
"Yes, used often.",
"Yes, used occasionally.",
"Yes, used seldomly, or ceremoniously.",
"No, this community does not permit alcohol use."
],
"Tobacco Use": [
"Yes, used often.",
"Yes, used occasionally.",
"No, not permitted.",
"Yes, used seldomly, or ceremoniously."
],
"Healthcare Styles": [
"Full Community Plan",
"Partial, Special, or Limited Community Plan",
"Up to each individual"
],
"Identified leader": [
"Yes",
"Yes, multiple identified leaders",
"No"
],
"Expected to share common diet": [
"No - people may eat however they wish.",
"Somewhat - there are some dietary restrictions or customs.",
"Yes - we all share a common diet."
],
"Open to members with pre-existing debt": [
"Yes",
"Yes (some debts)",
"No"
],
"Frequency of shared meals": [
"Rarely",
"1-3 times per month",
"About once a week",
"2-5 times per week",
"Approximately all dinners",
"Approximately all meals"
],
"Shared common area (house, building, or space)": [
    "Yes",
    "No"
    ],
    "Core leadership group": [
    "Yes",
    "No"
    ],
    "Required labor hours per week": {
    "Min Hours": null,
    "Max Hours": null
    },
    "Required join fee amount": {
    "Min Fee": null,
    "Max Fee": null
    },
    "Number of adult members": {
    "Required ongoing fee amount": {
    "Min #": null,
    "Max #": null,
    "Min Fee": null,
    "Max Fee": null
    }
    },
    "Number of children": {
    "Non-member residents": {
    "Min #": null,
    "Max #": null,
    "Min #": null,
    "Max #": null
    }
    }
    }

export async function valuesSelect(ctx, orbitdb) {

ctx.reply('Values', createButtons(dna))
}


function createButtons(requests){
    let buttons = []
    requests.forEach((request) => {
        buttons.push([Markup.button.callback(request.title, 'https://t.me/Bot?quests='+request._id), Markup.button.callback("Claim", 'claim_' + request._id)])
    })
    return Markup.inlineKeyboard(buttons)
}



