import HomeIcon from './icons/HomeIcon.svelte';
import StatusIcon from './icons/StatusIcon.svelte';
import GlobeIcon from './icons/MapIcon.svelte';
import CreditsIcon from './icons/CreditsIcon.svelte';
import ArchivesIcon from './icons/ArchivesIcon.svelte';
import TagsIcon from './icons/TagsIcon.svelte';
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
import ProposalsIcon from './icons/ProposalsIcon.svelte';
import MyHolonsIcon from './icons/MyHolonsIcon.svelte';
// Reuse Tags icon for SDGs in absence of a dedicated icon
import SDGsIcon from './icons/TagsIcon.svelte';
import OrbitsIcon from './icons/OrbitsIcon.svelte';

export const data = [
	{
		title: 'Dashboard',
		icon: DashboardIcon,
		link: '/dashboard'
	},
	{
		title: 'Tasks',
		icon: ArchivesIcon,
		link: '/tasks'
	},
	{
		title: 'Schedule',
		icon: CreditsIcon,
		link: '/calendar'
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
		title: 'Tags',
		icon: TagsIcon,
		link: '/tags'
	},
	{
		title: 'Proposals',
		icon: ProposalsIcon,
		link: '/proposals'
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
		title: 'Settings',
		icon: SettingsIcon,
		link: '/settings'
	},
	{
		title: 'Database',
		icon: DatabaseIcon,
		link: '/db'
	}
	// {
	// 	title: 'Documentation',
	// 	icon: DocumentationIcon,
	// 	link: '/admin/documentation'
	// }
];
