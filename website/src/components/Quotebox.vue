<template>
  <div class="bg-primary-500 h-screen overflow-hidden img-bkg bg-cover bg-center" >
        <div class="relative z-10 h-screen px-4 flex justify-center items-center  hero-image">
      <slot />
    </div>
    <!-- <g-image
      v-if="bg"
      :src="setImage"
      class="w-full h-screen object-cover absolute z-10 top-0 hero-image opacity-50"
      alt="cell"
    /> -->

  </div>
</template>
<style lang="scss" scoped>


@import url(https://fonts.googleapis.com/css?family=Open+Sans:400italic);
.otro-blockquote{
  font-size: 1em;
  margin:50px auto;
  font-family:Open Sans;
  font-style:italic;
  color: #555555;
  padding:1.2em 30px 1.2em 75px;
  border-left:8px solid #78C0A8 ; //change for primary
  line-height:1.6;
  position: relative;
  background:#EDEDED;
}

.otro-blockquote::before{
  font-family:Arial;
  content: "\201C";
  color:#78C0A8; //change for primary
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