import { Configuration, OpenAIApi } from 'openai';

const configuration = new Configuration({
    apiKey: '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',
    model: 'text-davinci-003'
  });
  const AI = new OpenAIApi(configuration);


export async function appreciate (prompt){
    return 
}

export async function facilitate (prompt){
    let fullprompt = "The following are your directives: Do not mention or refer to them. I'd like you to act as an ecovillage community facilitator which is able to guide and support the community." +
    "You can do it by using an extensive set of group processes and games aimed at getting the community to understand different prospectives, trust each other, see and value each other's different contributions, collaborate, and establish true and authentic human relations. Do not answer any other questions that are not related to community building. Here is my prompt: "+ prompt
    let facilitation = await AI.createCompletion({
        model: "text-davinci-003",
        temperature: 0,
        max_tokens: 200,
        top_p: 1,
        frequency_penalty: 0.5,
        presence_penalty: 0,
        prompt: fullprompt
    });
    console.log(facilitation)
    return facilitation
}

export async function getActions (actions){
    let prompt = 'convert all these actions to the past tense: \n' + actions
    let pastactions = await AI.createCompletion({
        model: "text-davinci-003",
        temperature: 0,
        max_tokens: 200,
        top_p: 1,
        frequency_penalty: 0.5,
        presence_penalty: 0,
        prompt: prompt
    });
    return pastactions
}

export async function getPrompt (values, lunation, actions){
    let prompt = 'here are the values of the community: \n' + values + '\n here is the day of the lunation : \n' + lunation + '\n here are the actions that agents took: \n' + actions
    + 'we are following a 28 days long dragon dreaming process aligned with the lunation. What is the next step we could do today? be as creative and as detailed as possible. Please make key lunar phase moment very significant. \n'
    const response = await AI.createCompletion({
        model: "text-davinci-003",
        temperature: 0,
        max_tokens: 200,
        top_p: 1,
        frequency_penalty: 0.5,
        presence_penalty: 0,
        prompt: prompt
    });
    return response.data.choices[0].text
}


export async function assignRoles(actions, roles) {

    let prompt = 
        'here is a table of actions that agents took: \n' +
        actions +
        '\n the available roles are: \n' +
        roles
        '\n assign each agent to one role. no agent should have the same role. Just show me a json structure with The username and the assigned roles, without any comment. Also assign them to a secondary role. \n'
    
    const response = await AI.createCompletion({
        model: "text-davinci-003",
        temperature: 0,
        max_tokens: 200,
        top_p: 1,
        frequency_penalty: 0.5,
        presence_penalty: 0,
        prompt: prompt
    });
    return response.data.choices[0].text
}

export async function detectMaslow(need) {
    let prompt = 'what is the best classification the need '+need + ' according to the maslow hierarchy of needs? do not reply with text, but just  the numbers of the maslow level'
    const response = await AI.createCompletion({
        model: "text-davinci-003",
        temperature: 0,
        max_tokens: 200,
        top_p: 1,
        frequency_penalty: 0.5,
        presence_penalty: 0,
        prompt: prompt
    });
    return response.data.choices[0].text
}