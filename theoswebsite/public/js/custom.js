const root = document.documentElement;
const moon = document.getElementById("moon-toggle");
const nav = document.querySelector("nav");
let night = true;
new WOW()
  .init();
//if the moon toggle present, set on click event listener
if (moon) {
  moon.addEventListener("click", e => {
    //if not night mode, turn it on
    if (!night) {
      nav.classList.remove('navbar-light')
      nav.classList.add('navbar-dark')
      //change variables
      root.style.setProperty('--black', '#000000');
      root.style.setProperty('--shade-900', '#242930');
      root.style.setProperty('--shade-800', '#353b43');
      root.style.setProperty('--shade-700', '#292F36');
      root.style.setProperty('--shade-500', '#4f5359');
      root.style.setProperty('--shade-300', '#ddd');
      root.style.setProperty('--shade-100', '#f8f8f8');
      root.style.setProperty('--white', '#fff');
      root.style.setProperty('--accent', '#57cbcc');
      root.style.setProperty('--accent-light', '#6CB670');
      root.style.setProperty('--text-color', '#737f8a');
      root.style.setProperty('--text-color-accent', '#afbac4');
      //change text
      e.target.innerHTML = "🌙"
      night = true;
    } else {
      nav.classList.remove('navbar-dark')
      nav.classList.add('navbar-light')
      //change variables
      root.style.setProperty('--black', 'white');
      root.style.setProperty('--shade-900', '#f8f8f8');
      root.style.setProperty('--shade-800', '#e7e7e7');
      root.style.setProperty('--shade-700', '#e0e0e0');
      root.style.setProperty('--shade-500', '#dddddd');
      root.style.setProperty('--shade-300', '#c6c6c6');
      root.style.setProperty('--shade-100', '#bdbdbd');
      root.style.setProperty('--white', 'black');
      root.style.setProperty('--accent', '#09234B');
      root.style.setProperty('--accent-light', '#09234B');
      root.style.setProperty('--text-color', '#05152D');
      root.style.setProperty('--text-color-accent', '#09234B');
      e.target.innerHTML = "🌕"
      night = false;
    }

  });
}