<template>
  <LayoutDefault>
    <!-- Learn how to use images here: https://gridsome.org/docs/images -->

    <h1>Hello, world!</h1>
    <div class="flex flex-wrap mt-10">
      <card v-for="card in cards" v-bind="card" :key="card.title"></card>
    </div>
  </LayoutDefault>
</template>



<script>
export default {
  metaInfo: {
    title: "Holons!"
  },

  data() {
    return {
      cards: [
        {
          title: "hello world",
          img: "https://picsum.photos/600/200",
          content:
            "Lorem ipsum dolor sit amet, consectetur adipisicing elit. Corporis neque, mollitia a magni ducimus aliquam blanditiis animi sequi beatae nisi facilis maiores voluptate doloribus necessitatibus est laborum vel. Quasi, nisi. "
        },
        {
          title: "this one has a link",
          img: "https://picsum.photos/600/300",
          link: "https://vuejs.org/v2/guide/components-props.html",
          content:
            "blanditiis animi sequi beatae nisi facilis maiores voluptate doloribus necessitatibus est laborum vel. Quasi, nisi. "
        },
        {
          title: "No image here",
          content:
            "Lorem ipsum dolor sit amet, consectetur adipisicing elit. Corporis neque, mollitia a magni ducimus aliquam blanditiis animi sequi beatae nisi facilis maiores voluptate doloribus necessitatibus est laborum vel. Quasi, nisi. "
        }
      ]
    };
  }
};
</script>