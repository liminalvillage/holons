import h3 from 'h3-js';

class H3 {
    constructor(bot, db) {
        this.bot = bot;
        this.db = db
    }

    async getHexWisdom(hex) {
        let wisdomDB = await this.db.docs('WeQuest.wisdom', {indexBy: 'id'});
        let wisdom = wisdomDB.get(hex);

    //const run = await openai.beta.threads.runs.retrieve(thread.id,run.id)
    const assistant = await openai.beta.assistants.retrieve("asst_qhk79F8wV9BDNuwfOI80TqzC")
    const thread = await openai.beta.threads.create()
    const message = await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: history
    })
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistant.id //,
      //instructions: "What is the meaning of life?",
    });
  
    let runStatus = await openai.beta.threads.runs.retrieve(
      thread.id,
      run.id
    );
    // Polling mechanism to see if runStatus is completed
    // This should be made more robust.
    while (runStatus.status !== "completed") {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    }
    // Get the latest messages from the thread
    const messages = await openai.beta.threads.messages.list(thread.id)
    const summary = messages.data[0].content[0].text.value.replace(/\`\`\`json\n/, '').replace(/\`\`\`/, '').trim()
    return summary
  }
  
        
    

    async getH3(lat, lng, resolution) {
        return h3.latLngToCell(lat, lng, resolution);
    }
    // returns the list of all the containing hexagons at xall scales
    getScalespace(lat, lng){ 
        let list = []
        let cell = h3.latLngToCell(lat, lng, 14);
        list.push(cell)
        for (let i = 13; i >= 0; i--) {
            list.push(h3.cellToParent(cell, i ))
        }
        return list
    }

    getSiblings(lat, lng, resolution) {
        let list = []
        let cell = h3.latLngToCell(lat, lng, resolution);
        list.push(cell)
        for (let i = 1; i <= 6; i++) {
            list.push(h3.cellToNeighbor(cell, i))
        }
        return list
    }

    async getH3Boundary(h3Index) {
        return h3.h3ToGeoBoundary(h3Index);
    }



    async getH3BoundaryKring(h3Index, k) {
        return h3.kRing(h3Index, k);
    }

    async getH3BoundaryKringDist(h3Index, k) {
        return h3.kRingDistances(h3Index, k);
    }

    async getH3BoundaryKringDistGeo(h3Index, k) {
        return h3.kRingDistances(h3Index, k, true);
    }

    async getH3BoundaryKringGeo(h3Index, k) {
        return h3.kRing(h3Index, k, true);
    }


}

export default H3;

let hexamap = new H3(null, null);
console.log(hexamap.getScalespace(40.689167, -74.044444));