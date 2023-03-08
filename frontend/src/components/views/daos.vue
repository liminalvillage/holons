<template>
  <z-view>
    Holons
    <div slot="extension">
      <!-- status monitor -->

      <!-- <z-list
      :items="moloches"
      :per-page="10"> 
          <z-spot 
          slot-scope="props"
          :index="props.index"
          :imagePath="'https://robohash.org/'+ props.memberAddress+'.png?set=set4'" 
          :label="truncate(props.memberAddress)"
          label-pos="bottom"
          @click.native= "normalize(props.index)">
          </z-spot>

      </z-list> -->
            <z-spot v-for="(moloch,index) in moloches" :key="moloch.title" :angle="index*30" :label="moloch.title" 
      :to-view= "{name:'holon', params: {address: moloch.id}}" > </z-spot>
      <z-spot
        :angle="150"
        :distance="50"
        size="s"
        label="Settings"
        to-view="settings">
        <i class="fas fa-sliders-h"></i>
      </z-spot>
    </div>
  </z-view>
</template>


<script>
import gql from 'graphql-tag'

export default {
  name:'Holons',
  apollo: {
    // Simple query that will update the 'hello' vue property
    moloches: gql`query {
      moloches (first:5) {
      id
      title
    }
    }`,
  },
}
</script>