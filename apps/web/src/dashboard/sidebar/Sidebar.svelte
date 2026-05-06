<script>
	import { sidebarExpanded } from '../store';
	import SidebarItems from './SidebarItems.svelte';

	const style = {
		mobileOrientation: {
			start: 'left-0 ',
			end: 'right-0 lg:left-0'
		},
		container: `pb-32 lg:pb-12 pt-16`,
		close: `duration-700 ease-out hidden transition-all lg:w-20`,
		open: `absolute duration-500 ease-in transition-all w-8/12 z-40 sm:w-5/12 md:w-64`,
		default: `sidebar-height overflow-y-auto overflow-x-hidden text-white top-0 lg:absolute sidebar-fade lg:block lg:z-40`
	};

	export let mobileOrientation = 'end';
</script>

<aside
	class={`${style.default} ${style.mobileOrientation[mobileOrientation]}
       ${$sidebarExpanded ? style.open : style.close}`}
	class:lg:w-64={$sidebarExpanded}
>
	<div class={style.container}>
		<SidebarItems />
	</div>
</aside>

<style>
	/* Sidebar height - accounts for topbar (56px) plus some margin */
	:global(.sidebar-height) {
		height: calc(100vh - 56px);
		margin-top: 0;
	}

	/* Sidebar fade to transparent on right edge */
	:global(.sidebar-fade) {
		background: linear-gradient(to right, rgb(17, 24, 39) 0%, rgb(17, 24, 39) 85%, transparent 100%);
	}

	.scrollbar::-webkit-scrollbar {
		width: 0;
		background: transparent; /* hide Sidebar scrollbar on Chrome, Opera and other webkit Browsers*/
	}
	.scrollbar {
		-ms-overflow-style: none;
	}
</style>
