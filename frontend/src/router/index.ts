import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import LoginView from '../views/LoginView.vue';
import HomeView from '../views/HomeView.vue';
import AppShell from '../layouts/AppShell.vue';
import UserListView from '../views/users/UserListView.vue';
import DepartmentListView from '../views/departments/DepartmentListView.vue';
import TicketCategoryListView from '../views/ticketCategories/TicketCategoryListView.vue';
import TicketListView from '../views/tickets/TicketListView.vue';
import TicketCreateView from '../views/tickets/TicketCreateView.vue';
import TicketDetailView from '../views/tickets/TicketDetailView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    {
      path: '/',
      component: AppShell,
      meta: { requiresAuth: true },
      children: [
        { path: '', name: 'home', component: HomeView },
        { path: 'tickets', name: 'tickets', component: TicketListView },
        { path: 'tickets/new', name: 'ticket-new', component: TicketCreateView },
        { path: 'tickets/:id', name: 'ticket-detail', component: TicketDetailView },
        { path: 'users', name: 'users', component: UserListView, meta: { roles: ['ADMIN'] } },
        { path: 'departments', name: 'departments', component: DepartmentListView, meta: { roles: ['ADMIN'] } },
        {
          path: 'ticket-categories',
          name: 'ticket-categories',
          component: TicketCategoryListView,
          meta: { roles: ['ADMIN'] },
        },
      ],
    },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login' };
  }
  const roles = to.meta.roles as string[] | undefined;
  if (roles && (!auth.currentUser || !roles.includes(auth.currentUser.role))) {
    return { name: 'home' };
  }
  return true;
});

export default router;
