import { useRef, useState } from 'react';
import { CircleHelp, ExternalLink, Info, Send } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { SidebarMenuButton } from '@/components/ui/sidebar';
import { t } from '../_shared/i18n.ts';
import { dotIpc } from '../services/ipc.ts';
import { AboutDialog } from '../settings/AboutDialog.tsx';

const FEEDBACK_URL = 'https://github.com/apricot-cake/dot/issues/new';

export function HelpMenu() {
  const [aboutOpen, setAboutOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuButton ref={triggerRef}>
              <CircleHelp />
              <span data-slot="menu-label">{t('helpMenuLabel')}</span>
            </SidebarMenuButton>
          }
        />
        <DropdownMenuContent side="right" align="end" sideOffset={8} className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => dotIpc.openExternal(FEEDBACK_URL)}>
              <Send />
              {t('aboutLinkFeedback')}
              <ExternalLink className="ml-auto size-3.5" />
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setAboutOpen(true)}>
              <Info />
              {t('aboutTitle')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} finalFocus={triggerRef} />
    </>
  );
}
