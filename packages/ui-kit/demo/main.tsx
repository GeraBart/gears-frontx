import { StrictMode, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import '@gears-frontx/ui-kit/theme.css';
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
  Toaster,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@gears-frontx/ui-kit';

const COLOR_TOKENS = [
  'background',
  'foreground',
  'surface',
  'surface-elevated',
  'card',
  'card-hover',
  'popover',
  'primary',
  'primary-hover',
  'secondary',
  'muted',
  'muted-foreground',
  'subtle-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'success',
  'success-soft',
  'warning',
  'warning-soft',
  'danger',
  'danger-soft',
  'info',
  'info-soft',
  'blue',
  'border',
  'border-strong',
  'input',
  'ring',
  'sidebar',
  'sidebar-accent',
  'code-background',
  'code-foreground',
];

const RADII = ['xs', 'sm', 'md', 'lg', 'xl'];
const SPACES = ['1', '2', '3', '4', '5', '6', '8'];

const REGIONS = [
  { value: 'eu-central', label: 'Frankfurt' },
  { value: 'eu-west', label: 'Dublin' },
  { value: 'us-east', label: 'Virginia' },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{title}</h2>
      {children}
    </section>
  );
}

function Row({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 'var(--space-3)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Swatch({ token }: { token: string }) {
  return (
    <div style={{ width: 108, fontSize: 11 }}>
      <div
        style={{
          height: 44,
          borderRadius: 'var(--radius-sm)',
          background: `var(--${token})`,
          border: 'var(--border-width) solid var(--border-strong)',
        }}
      />
      <code style={{ color: 'var(--muted-foreground)' }}>--{token}</code>
    </div>
  );
}

function DemoIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2v12M2 8h12" strokeLinecap="round" />
    </svg>
  );
}

function LoadingDemo() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      loading={busy}
      onClick={() => {
        setBusy(true);
        setTimeout(() => setBusy(false), 1500);
      }}
    >
      Click me
    </Button>
  );
}

function ThemeSwitch() {
  const [theme, setTheme] = useState('auto');
  useEffect(() => {
    if (theme === 'auto') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }
  }, [theme]);
  return (
    <Row>
      {['auto', 'light', 'dark'].map((mode) => (
        <Button
          key={mode}
          size="sm"
          variant={theme === mode ? 'default' : 'outline'}
          onClick={() => setTheme(mode)}
        >
          {mode}
        </Button>
      ))}
    </Row>
  );
}

function App() {
  const [region, setRegion] = useState<string | null>(null);
  return (
    <main
      style={{
        maxWidth: 960,
        margin: '0 auto',
        padding: 'var(--space-8) var(--space-6)',
        display: 'grid',
        gap: 'var(--space-8)',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600 }}>ui-kit kitchen sink</h1>
        <ThemeSwitch />
      </header>

      <Section title="Color tokens">
        <Row>
          {COLOR_TOKENS.map((token) => (
            <Swatch key={token} token={token} />
          ))}
        </Row>
      </Section>

      <Section title="Radius & spacing">
        <Row>
          {RADII.map((step) => (
            <div key={step} style={{ textAlign: 'center', fontSize: 11 }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: `var(--radius-${step})`,
                  border: 'var(--border-width) solid var(--border-strong)',
                  background: 'var(--card)',
                }}
              />
              <code>--radius-{step}</code>
            </div>
          ))}
          <Separator orientation="vertical" style={{ height: 56 }} />
          {SPACES.map((step) => (
            <div key={step} style={{ textAlign: 'center', fontSize: 11 }}>
              <div
                style={{
                  width: `var(--space-${step})`,
                  height: 40,
                  background: 'var(--primary)',
                  borderRadius: 'var(--radius-xs)',
                }}
              />
              <code>{step}</code>
            </div>
          ))}
        </Row>
      </Section>

      <Section title="Button">
        <Row>
          <Button>default</Button>
          <Button variant="secondary">secondary</Button>
          <Button variant="outline">outline</Button>
          <Button variant="ghost">ghost</Button>
          <Button variant="destructive">destructive</Button>
          <Button variant="link">link</Button>
        </Row>
        <Row>
          <Button size="sm">sm</Button>
          <Button>default</Button>
          <Button size="lg">lg</Button>
          <Button disabled>disabled</Button>
        </Row>
        <Row>
          <Button icon={<DemoIcon />}>with icon</Button>
          <Button size="sm" icon={<DemoIcon />} aria-label="icon-only sm" />
          <Button icon={<DemoIcon />} aria-label="icon-only default" />
          <Button size="lg" icon={<DemoIcon />} aria-label="icon-only lg" />
          <Button size="lg" variant="secondary" icon={<DemoIcon />} aria-label="secondary icon" />
        </Row>
        <Row>
          <Button loading>loading</Button>
          <Button variant="secondary" loading>
            loading
          </Button>
          <Button variant="outline" loading icon={<DemoIcon />} aria-label="loading icon-only" />
          <LoadingDemo />
        </Row>
      </Section>

      <Section title="Badge">
        <Row>
          <Badge>default</Badge>
          <Badge variant="secondary">secondary</Badge>
          <Badge variant="destructive">destructive</Badge>
          <Badge variant="outline">outline</Badge>
          <Badge variant="ghost">ghost</Badge>
          <Badge variant="link">link</Badge>
        </Row>
      </Section>

      <Section title="Form controls">
        <div style={{ display: 'grid', gap: 'var(--space-4)', maxWidth: 420 }}>
          <Field name="email">
            <FieldLabel>Email</FieldLabel>
            <Input type="email" required placeholder="you@company.com" />
            <FieldDescription>We only use it for the invoice.</FieldDescription>
            <FieldError match="valueMissing">Email is required.</FieldError>
          </Field>
          <Field name="broken" invalid>
            <FieldLabel>Invalid state</FieldLabel>
            <Input defaultValue="wrong value" aria-invalid />
            <FieldError match>Server rejected this value.</FieldError>
          </Field>
          <Field name="notes">
            <FieldLabel>Notes</FieldLabel>
            <Textarea placeholder="Multi-line text…" />
          </Field>
          <Select value={region} onValueChange={setRegion} items={REGIONS}>
            <SelectTrigger aria-label="Region">
              <SelectValue placeholder="Pick a region" />
            </SelectTrigger>
            <SelectContent>
              {REGIONS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Row>
            <Label>
              <Checkbox defaultChecked /> Checkbox
            </Label>
            <Label>
              <Switch defaultChecked /> Switch
            </Label>
            <Label>
              <Switch size="sm" /> Switch sm
            </Label>
          </Row>
          <RadioGroup defaultValue="a" style={{ display: 'flex', gap: 'var(--space-4)' }}>
            <Label>
              <RadioGroupItem value="a" /> Option A
            </Label>
            <Label>
              <RadioGroupItem value="b" /> Option B
            </Label>
          </RadioGroup>
        </div>
      </Section>

      <Section title="Card">
        <Card style={{ maxWidth: 420 }}>
          <CardHeader>
            <CardTitle>Project Amber</CardTitle>
            <CardDescription>Updated 2 hours ago</CardDescription>
            <CardAction>
              <Badge>active</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>Surfaces sit on --card with --border; hover state is up to the consumer.</CardContent>
          <CardFooter>
            <Button size="sm">Open</Button>
          </CardFooter>
        </Card>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="one">
          <TabsList>
            <TabsTrigger value="one">Default one</TabsTrigger>
            <TabsTrigger value="two">Two</TabsTrigger>
            <TabsTrigger value="three" disabled>
              Disabled
            </TabsTrigger>
          </TabsList>
          <TabsContent value="one">First panel.</TabsContent>
          <TabsContent value="two">Second panel.</TabsContent>
        </Tabs>
        <Tabs defaultValue="one">
          <TabsList variant="line">
            <TabsTrigger value="one">Line one</TabsTrigger>
            <TabsTrigger value="two">Two</TabsTrigger>
          </TabsList>
          <TabsContent value="one">First panel.</TabsContent>
          <TabsContent value="two">Second panel.</TabsContent>
        </Tabs>
      </Section>

      <Section title="Table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Region</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>gears-api</TableCell>
              <TableCell>
                <Badge>running</Badge>
              </TableCell>
              <TableCell>eu-central</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>gears-worker</TableCell>
              <TableCell>
                <Badge variant="destructive">failed</Badge>
              </TableCell>
              <TableCell>us-east</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Section>

      <Section title="Overlays & feedback">
        <Row>
          <Dialog>
            <DialogTrigger render={<Button variant="outline">Open dialog</Button>} />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete project?</DialogTitle>
                <DialogDescription>This action cannot be undone.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline">Cancel</Button>} />
                <DialogClose render={<Button variant="destructive">Delete</Button>} />
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline">Dropdown</Button>} />
            <DropdownMenuContent>
              <DropdownMenuItem>Rename</DropdownMenuItem>
              <DropdownMenuItem>Duplicate</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost">Hover me</Button>} />
            <TooltipContent>Visual-only hint.</TooltipContent>
          </Tooltip>
          <Button
            variant="secondary"
            onClick={() =>
              toast.add({ title: 'Saved', description: 'Palette applied.', type: 'success' })
            }
          >
            Success toast
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.add({ title: 'Failed', description: 'Try again.', type: 'error' })}
          >
            Error toast
          </Button>
        </Row>
      </Section>

      <Section title="Skeleton">
        <Row>
          <Skeleton style={{ width: 220, height: 16 }} />
          <Skeleton style={{ width: 44, height: 44, borderRadius: '50%' }} />
        </Row>
      </Section>

      <Toaster />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
