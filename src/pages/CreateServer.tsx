import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { CreateServerWizard } from '@/components/CreateServerWizard';

export default function CreateServerPage() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Create server"
        breadcrumbs={[
          { label: 'Servers', to: '/servers' },
          { label: 'Create server' },
        ]}
      />

      <CreateServerWizard
        open={true}
        onClose={() => navigate('/servers')}
        onCreated={(s) => navigate(`/servers/${s.id}`)}
      />
    </div>
  );
}
