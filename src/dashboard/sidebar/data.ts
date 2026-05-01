import HomeIcon from './icons/HomeIcon.svelte';
import StatusIcon from './icons/StatusIcon.svelte';
import GlobeIcon from './icons/MapIcon.svelte';
import CreditsIcon from './icons/CreditsIcon.svelte';
import ArchivesIcon from './icons/ArchivesIcon.svelte';
import SettingsIcon from './icons/SettingsIcon.svelte';
import DatabaseIcon from './icons/DatabaseIcon.svelte';
import DocumentationIcon from './icons/DocumentationIcon.svelte';
import RolesIcon from './icons/RolesIcon.svelte';
import OffersIcon from './icons/OffersIcon.svelte';
import DashboardIcon from './icons/DashboardIcon.svelte';
import ShoppingIcon from './icons/ShoppingIcon.svelte';
import ChecklistIcon from './icons/ChecklistIcon.svelte';
import ExpensesIcon from './icons/ExpensesIcon.svelte';
import FederationIcon from './icons/FederationIcon.svelte';
import MyHolonsIcon from './icons/MyHolonsIcon.svelte';
import OrbitsIcon from './icons/OrbitsIcon.svelte';
import FlowIcon from './icons/FlowIcon.svelte';
import LibraryIcon from './icons/LibraryIcon.svelte';

export const data = [
	{
		title: 'Schedule',
		icon: CreditsIcon,
		link: '/calendar'
	},
	{
		title: 'Tasks',
		icon: ArchivesIcon,
		link: '/tasks'
	},
	{
		title: 'Expenses',
		icon: ExpensesIcon,
		link: '/expenses'
	},
	{
		title: 'Roles',
		icon: RolesIcon,
		link: '/roles'
	},
	{
		title: 'Map',
		icon: GlobeIcon,
		link: '/map'
	},
	{
		title: 'Offers & Requests',
		icon: OffersIcon,
		link: '/offers'
	},
	{
		title: 'Shopping List',
		icon: ShoppingIcon,
		link: '/shopping'
	},
	{
		title: 'Library',
		icon: LibraryIcon,
		link: '/library'
	},
	{
		title: 'Checklists',
		icon: ChecklistIcon,
		link: '/checklists'
	},
	{
		title: 'Status',
		icon: StatusIcon,
		link: '/status'
	},
	{
		title: 'Federation',
		icon: FederationIcon,
		link: '/federation'
	},
	{
		title: 'Flow',
		icon: FlowIcon,
		link: '/flow'
	},
	{
		title: 'Settings',
		icon: SettingsIcon,
		link: '/settings'
	},
	{
		title: 'Database',
		icon: DatabaseIcon,
		link: '/db'
	},
	{
		title: 'Statistics',
		icon: DashboardIcon,
		link: '/statistics'
	}
	// {
	// 	title: 'Documentation',
	// 	icon: DocumentationIcon,
	// 	link: '/admin/documentation'
	// }
];
