<template>
  <LayoutHero>
    <template slot="hero">
      <hero-container :bg="heroBG">
        <h1 class="text-6xl text-primary-500">Holons</h1> 
      </hero-container>
    </template>

    <div class="flex flex-wrap my-10">
      <card v-for="card in cards" v-bind="card" :key="card.title"></card>
    </div>


    <div class="bg-white shadow-lg py-16 px-32">
      
      <h2>Holons</h2>
      <p>Holons is a "liquid renumeration" structure built on Ethereum; the mechanism fundementally consists of a stackable payment splitter that weights fund appropriation according to "appreciation" signaled amongst participants.</p>
      <h3 class="mt-8">Background</h3>
      <p>
        <b>Reputation is highly contextual</b> - which makes it extreamly hard to implement as a system in real life, especially due to the granularity and diversity of actions we undertake. At present, there are two ways of approaching the issue - by picking objective verticals that can be easily measured, or by choosing a high level topology and allowing users to make subjective assessments across a broad range of horizontal activities. Both options have considerable hurdles to manage - the former being an infinity of objective measurements, the latter being a plurality of subjective worldviews. With these acknoleged we chose the latter path. 
      </p>
      <h3 id="details" class="mt-8">Definition of Holon</h3>
      
      <blockquote class="otro-blockquote"> <!-- this guy needs to be positioned back a bit -->
      <p> A holon is an evolving self-organizing structure, composed of other holons. A holon is simultaneously a whole in itself and at the same time is nested within another holon and so is a part of something much larger than itself. Holons range in size from the smallest subatomic particles and strings, all the way up to the multiverse, comprising many universes. Individual humans, their societies and their cultures are intermediate level holons, created by the interaction of forces working upon us both top-down and bottom-up.A holon is an evolving self-organizing structure, composed of other holons, whose structures exist at a balance point between chaos and order. A holon is simultaneously a whole in itself and at the same time is nested within another holon and so is a part of something much larger than itself. Holons range in size from the smallest subatomic particles and strings, all the way up to the multiverse, comprising many universes. Individual humans, their societies and their cultures are intermediate level holons, created by the interaction of forces working upon us both top-down and bottom-up. </p>
      </blockquote>
      <h3 class="mt-8"> Motivation</h3>

        <p> How do we account for Open Soure contributions? </p>

        <ul class="bullets px-12">
          <li> In the realm of quantity; Peter Drucker states "what gets measured, gets managed", while Goodharts Law dictates that "when a measure becomes a target, it ceases to be a good measure".</li>
          <li> In the realm of subjective quality; we must acknowledge that qualities are an emergent property of an interrelated schema - which is a potentially infinite list.</li>
        </ul>

        <p>There are obviously pros and cons to both approaches, but since the industrial revolution we've arguably enshrined a bias towards paradigms of objective quantification. This has lead to the creation of accounting tools which continuously shape our mindsets in this tradition. The most obvious of these is fiat currency. The cryptocurrency community has made displacing this outdated system a rally cry, though the paradigm hasn't moved on much as evidenced in continued speculation and the exclusive barter of short term mediums of exchange (tokens). As such, we are potentially just recreating another form of capitalism.</p>

        <p>How do we avoid creating a flatland devoid of qualitative meaning? How can we broaden our perspective to be more inclusive of a plurality of values? Well, it's our assertion that an integration of both qualitative and quantitative measures is necessary.</p>

        <ul class="bullets px-12">
          <li> On the quantitative side, we can build upon the current paradigm, which has also become one of Ethereum's primary use cases - payments. Payments are a specific objective quantification of value, necessary for most people in todays socio-economic climate. Our innovation lies in how we distribute this "payment".</li>

          <li> On the other side, qualifiers (eg:badges, or Gitcoin Kudos) are an emergent property of an action, but these qualities might be too sparse to be considered a useful to turn into a measurable. Therefore, we suggest to use Appreciation as a signal which can integrate both the quantitative and qualitative realms. Using this single subjective signal paradoxically allows us to measure all subjective qualities in a very simple way, which can then be used to direct payments.</li>
        </ul>
      
      <h3 class="mt-12"> Introducing Holons! </h3>
        
        <p>Each Holon has its own Ethereum address where ether and any ERC20 tokens can be sent. This value will be automatically split across its members. This resembles the way dividends work within a traditional organizations; the fundamental differences is that shares in the holon can't be purchased or are not set in advance, but computed at the moment of payment proportionally to the appreciation received by the holon members.</p>

        <p>Holons thus allows users to dish appreciation as a non-scarce subjective quantifier that acts as a generalised correlate for payment distribution.</p>

        <p>As members cannot give appreciation to themselves, we obtain an altruistic peer to peer signal to highlight the people who have significantly advanced the project or have closely collaborated to the other members. Doing care work for your hack team? If people "appreciate" your efforts you will receive a proportional amount of the income according to the appreciation graph. Same thing goes for design, development, logistics, marketing etc. This setup allows for people to work across multiple teams and work wherever they are appreciated, wherever they are.</p>

        <p>Holons can also be nested: a marketing holon could receive funds from the appreciation sent over from the sales holon, and in turn it would be split the received funds to its members. As people can join different holon, they receive funds from multiple streams within the same organization, and also across different organizations. In fact, organizations and projects can also join together into higher-order holons, sending appreciation to each other, and sharing common achievements.</p>

        <p>It is a completelly new way of thinking about organizations: People will be able to join the causes and projects they care about, contribute and get appreciated. Whenever a payment is received (Eg: a price money, a grant, commercial licenses), it will flow automatically through the entire holonic structure, rewarding the right people.</p>
    </div>
  </LayoutHero>
</template>

<script>
export default {
  metaInfo: {
    title: "Holons home!"
  },

  data() {
    return {
      heroBG: "mineraltexture.jpg",
      cards: [
        {
          title: "this one has a link",
          img: "https://picsum.photos/600/300",
          link: "https://vuejs.org/v2/guide/components-props.html",
          content:
            "blanditiis animi sequi beatae nisi facilis maiores voluptate doloribus necessitatibus est laborum vel. Quasi, nisi. "
        },
        {
          title: "hello world",
          img: "card.png",
          extraClassImg: "h-64",
          content:
            "Lorem ipsum dolor sit amet, consectetur adipisicing elit. Corporis neque, mollitia a magni ducimus aliquam blanditiis animi sequi beatae nisi facilis maiores voluptate doloribus necessitatibus est laborum vel. Quasi, nisi. "
        },

        {
          title: "Intentionally blank",
          content:
            "Lorem ipsum dolor sit amet, consectetur adipisicing elit. Corporis neque, mollitia a magni ducimus aliquam blanditiis animi sequi beatae nisi facilis maiores voluptate doloribus necessitatibus est laborum vel. Quasi, nisi. "
        },
      ]
    };
  }
};
</script>



<style lang="scss">
@import url(https://fonts.googleapis.com/css?family=Open+Sans:400italic);
.otro-blockquote{
  font-size: 1em;
  margin:10px auto;
  font-family:Open Sans;
  font-style:italic;
  color: #555555;
  padding:1.2em 30px 1.2em 75px;
  border-left:8px solid #033E8C; //change for primary
  line-height:1.6;
  position: relative;
  background:#EDEDED;
}

.otro-blockquote::before{
  font-family:Arial;
  content: "\201C";
  color:#033E8C; //change for primary
  font-size:4em;
  position: absolute;
  left: 10px;
  top:-10px;
}

.otro-blockquote::after{
  content: '';
}

.otro-blockquote span{
  display:block;
  color:#333333;
  font-style: normal;
  font-weight: bold;
  margin-top:1em;
}

.bullets li {
 list-style-type: circle;
 margin-bottom: .4em;
 }

.hero-text {
  mix-blend-mode: exclusion;
  color: white;
}

.body {
  background: url(http://unsplash.it/1499/1000);
  background-size: 100%;
  background-size: cover;
  background-repeat: no-repeat;
}

.blend {
  mix-blend-mode: screen;
  color: white;
  display: block;
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  font-size: 6vw;
}

.red {
  color: red;
}

.blue {
  color: blue;
}

.green {
  color: green;
}

blockquote {
  margin-bottom: 100px;
  line-height: 1.1;
}
</style>
