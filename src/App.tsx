import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Circle,
  Code2,
  Database,
  Download,
  FileText,
  FolderKanban,
  Gauge,
  HelpCircle,
  Home,
  Lightbulb,
  Menu,
  Moon,
  Play,
  RotateCcw,
  Settings,
  Sun,
  Table2,
  Trophy,
  Upload,
  X,
} from "lucide-react";
import { basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { sql } from "@codemirror/lang-sql";
import {
  modules,
  allLessons,
  findLesson,
  type Lesson,
} from "./content/curriculum";
import type { QueryResult } from "./engine/sqlEngine";
import {
  initialProgress,
  loadProgress,
  saveProgress,
  serializeProgress,
  parseProgress,
  downloadText,
  type AppProgress,
} from "./storage/progress";
import { SqlClient } from "./engine/client";
import "./App.css";

type Page =
  | "dashboard"
  | "materi"
  | "playground"
  | "latihan"
  | "portofolio"
  | "pengaturan";
type RunSql = <T>(action: Record<string, unknown>) => Promise<T>;

function useSqlWorker(): RunSql {
  const client = useRef<SqlClient | null>(null);
  useEffect(
    () => () => {
      client.current?.dispose();
      client.current = null;
    },
    [],
  );
  return useCallback(<T,>(action: Record<string, unknown>): Promise<T> => {
    client.current ??= new SqlClient();
    return client.current.request<T>(action);
  }, []);
}

function useProgressState() {
  const [progress, setProgress] = useState<AppProgress>(initialProgress);
  const [ready, setReady] = useState(false);
  const [storageStatus, setStorageStatus] = useState("Memuat progres…");
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    let active = true;
    void loadProgress()
      .then((value) => {
        if (active) {
          setProgress(value);
          setReady(true);
        }
      })
      .catch((reason: unknown) => {
        if (active)
          setLoadError(
            reason instanceof Error
              ? reason.message
              : "Penyimpanan tidak tersedia.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    setStorageStatus("Menyimpan…");
    void saveProgress(progress)
      .then(() => {
        if (active) setStorageStatus("Tersimpan di perangkat");
      })
      .catch((reason: unknown) => {
        if (active)
          setStorageStatus(
            `Gagal menyimpan: ${reason instanceof Error ? reason.message : "penyimpanan tidak tersedia"}. Ekspor backup sebelum menutup.`,
          );
      });
    return () => {
      active = false;
    };
  }, [progress, ready]);
  const update = useCallback(
    (fn: (value: AppProgress) => AppProgress) => setProgress(fn),
    [],
  );
  return { progress, update, ready, storageStatus, loadError };
}

function App() {
  const { progress, update, ready, storageStatus, loadError } =
    useProgressState();
  const runSql = useSqlWorker();
  const [page, setPage] = useState<Page>("dashboard");
  const [lessonId, setLessonId] = useState("l1");
  const dark = progress.theme === "dark";
  const setDark = (fn: (value: boolean) => boolean) =>
    update((p) => ({ ...p, theme: fn(p.theme === "dark") ? "dark" : "light" }));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toast, setToast] = useState("");
  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3000);
  }, []);
  useEffect(() => {
    if (ready) setLessonId(progress.lastLessonId);
  }, [ready, progress.lastLessonId]);
  useEffect(() => {
    document.documentElement.dataset.theme = progress.theme;
  }, [progress.theme]);
  const openLesson = (id: string) => {
    setLessonId(id);
    setPage("materi");
    setMobileOpen(false);
    update((p) => ({
      ...p,
      lastLessonId: id,
      lessons: {
        ...p.lessons,
        [id]: {
          ...(p.lessons[id] ?? {
            status: "not-started",
            attempts: 0,
            passed: false,
            score: 0,
            draft: findLesson(id).starter,
            hintsUsed: 0,
            updatedAt: "",
          }),
          status: "learning",
          updatedAt: new Date().toISOString(),
        },
      },
    }));
  };
  const completed = allLessons.filter(
    (lesson) => progress.lessons[lesson.id]?.passed,
  ).length;
  const pageContent =
    page === "dashboard" ? (
      <Dashboard
        progress={progress}
        completed={completed}
        onContinue={() => openLesson(progress.lastLessonId)}
        onPage={setPage}
      />
    ) : page === "materi" ? (
      <LessonPage
        lesson={findLesson(lessonId)}
        progress={progress}
        update={update}
        runSql={runSql}
        notify={notify}
        onPage={setPage}
      />
    ) : page === "playground" ? (
      <Playground runSql={runSql} notify={notify} />
    ) : page === "latihan" ? (
      <Practice progress={progress} onOpen={openLesson} />
    ) : page === "portofolio" ? (
      <Portfolio
        progress={progress}
        update={update}
        runSql={runSql}
        notify={notify}
      />
    ) : (
      <SettingsPage progress={progress} update={update} notify={notify} />
    );
  if (!ready)
    return (
      <main className="page-wrap" role="status">
        <h1>QueryCraft</h1>
        <p>{loadError || "Memuat progres lokal…"}</p>
        {loadError && (
          <>
            <p>
              Data lama tidak ditimpa. Periksa izin penyimpanan browser lalu
              coba lagi.
            </p>
            <button onClick={() => location.reload()}>Muat ulang</button>
          </>
        )}
      </main>
    );
  return (
    <div className="app-shell">
      <p
        role="status"
        aria-live="polite"
        style={{ margin: 0, padding: "4px 20px", fontSize: 12 }}
      >
        {storageStatus}
      </p>
      <header className="topbar">
        <button
          className="mobile-menu icon-button"
          onClick={() => setMobileOpen((value) => !value)}
          aria-label="Buka menu"
        >
          <Menu size={20} />
        </button>
        <div className="brand">
          <span className="brand-mark">
            <Code2 size={19} />
          </span>
          Query<span className="brand-accent">Craft</span>
        </div>
        <div className="topbar-meta">
          <span className="save-state">
            <span className="save-dot" /> {storageStatus}
          </span>
          <button
            className="icon-button"
            onClick={() => setDark((value) => !value)}
            aria-label="Ganti tema"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <div className="avatar">DA</div>
        </div>
      </header>
      <div className="layout">
        <Sidebar
          page={page}
          progress={progress}
          open={mobileOpen}
          setPage={(value) => {
            setPage(value);
            setMobileOpen(false);
          }}
          openLesson={openLesson}
        />
        <main className="main-content">{pageContent}</main>
      </div>
      {toast && (
        <div className="toast">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}

function Sidebar({
  page,
  progress,
  open,
  setPage,
  openLesson,
}: {
  page: Page;
  progress: AppProgress;
  open: boolean;
  setPage: (page: Page) => void;
  openLesson: (id: string) => void;
}) {
  return (
    <aside className={open ? "sidebar open" : "sidebar"}>
      <div className="sidebar-scroll">
        <nav className="main-nav">
          <NavButton
            icon={<Home size={18} />}
            label="Dashboard"
            active={page === "dashboard"}
            onClick={() => setPage("dashboard")}
          />
          <NavButton
            icon={<BookOpen size={18} />}
            label="Materi SQL"
            active={page === "materi"}
            onClick={() => setPage("materi")}
          />
          <NavButton
            icon={<Code2 size={18} />}
            label="SQL Playground"
            active={page === "playground"}
            onClick={() => setPage("playground")}
          />
          <NavButton
            icon={<CheckCircle2 size={18} />}
            label="Latihan"
            active={page === "latihan"}
            onClick={() => setPage("latihan")}
          />
          <NavButton
            icon={<FolderKanban size={18} />}
            label="Portofolio"
            active={page === "portofolio"}
            onClick={() => setPage("portofolio")}
          />
        </nav>
        <div className="nav-divider" />
        <div className="sidebar-label">KURIKULUM</div>
        <div className="module-nav">
          {modules.map((module) => {
            const done = module.lessons.filter(
              (lesson) => progress.lessons[lesson.id]?.passed,
            ).length;
            return (
              <button
                className="module-link"
                key={module.id}
                onClick={() => openLesson(module.lessons[0].id)}
              >
                <span className="module-number">
                  {done === module.lessons.length ? (
                    <CheckCircle2 size={15} />
                  ) : (
                    module.number
                  )}
                </span>
                <span className="module-title">{module.title}</span>
                <span className="module-count">
                  {done}/{module.lessons.length}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <button className="settings-link" onClick={() => setPage("pengaturan")}>
        <Settings size={17} /> Pengaturan
      </button>
    </aside>
  );
}
function NavButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "nav-button active" : "nav-button"}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: React.ReactNode;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {action}
    </div>
  );
}

function Dashboard({
  progress,
  completed,
  onContinue,
  onPage,
}: {
  progress: AppProgress;
  completed: number;
  onContinue: () => void;
  onPage: (page: Page) => void;
}) {
  const overall = Math.round((completed / allLessons.length) * 100);
  const attempts = Object.values(progress.lessons).filter(
    (item) => item.attempts > 0,
  ).length;
  return (
    <div className="page-wrap">
      <PageHeading
        eyebrow="RINGKASAN BELAJAR"
        title={
          <>
            Selamat datang kembali,{" "}
            <span className="heading-accent">Data Analyst!</span>
          </>
        }
        description="Lanjutkan perjalananmu menguasai SQL dan ubah data menjadi insight."
        action={
          <button className="primary-button" onClick={onContinue}>
            <Play size={17} fill="currentColor" /> Lanjutkan belajar
          </button>
        }
      />
      <section className="hero-card">
        <div className="hero-copy">
          <div className="hero-chip">
            <Lightbulb size={14} /> TRACK PROGRESS
          </div>
          <h2>
            Bangun fondasi SQL
            <br />
            <span>yang kuat.</span>
          </h2>
          <p>
            Belajar dengan contoh nyata, latihan interaktif, dan proyek
            portofolio yang siap dipamerkan.
          </p>
          <button className="hero-button" onClick={onContinue}>
            Mulai dari terakhir <ArrowRight size={16} />
          </button>
        </div>
        <div className="hero-visual">
          <div className="code-window">
            <div className="window-dots">
              <i />
              <i />
              <i />
            </div>
            <pre>
              <span className="code-purple">SELECT</span> insight, growth{`\n`}
              <span className="code-purple">FROM</span> your_data{`\n`}
              <span className="code-purple">WHERE</span> curiosity{" "}
              <span className="code-purple">IS NOT NULL</span>;{`\n`}
              <span className="code-comment">-- your career starts here</span>
            </pre>
          </div>
        </div>
      </section>
      <div className="stats-grid">
        <Stat
          icon={<Gauge />}
          label="Progress keseluruhan"
          value={`${overall}%`}
          detail={`${completed} dari ${allLessons.length} pelajaran selesai`}
          progress={overall}
        />
        <Stat
          icon={<Code2 />}
          label="Latihan dikerjakan"
          value={`${attempts}`}
          detail={`${Object.values(progress.lessons).filter((item) => item.passed).length} berhasil diselesaikan`}
        />
        <Stat
          icon={<Trophy />}
          label="Pencapaian"
          value={`${Object.values(progress.lessons).filter((item) => item.passed).length}`}
          detail="Badge dihitung otomatis"
        />
      </div>
      <div className="dashboard-grid">
        <section className="panel activity-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">AKTIVITAS TERBARU</p>
              <h3>Teruskan progresmu</h3>
            </div>
            <button className="text-button" onClick={() => onPage("materi")}>
              Lihat semua <ArrowRight size={14} />
            </button>
          </div>
          {progress.activities.length ? (
            progress.activities.slice(0, 4).map((item) => (
              <div className="activity-row" key={item.id}>
                <CheckCircle2 size={18} />
                <div>
                  <strong>{item.text}</strong>
                  <span>{new Date(item.at).toLocaleDateString("id-ID")}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <ClockIcon />
              <p>Belum ada aktivitas. Mulai pelajaran pertamamu.</p>
            </div>
          )}
        </section>
        <section className="panel next-panel">
          <p className="eyebrow">PELAJARAN BERIKUTNYA</p>
          <div className="next-icon">
            <Code2 size={22} />
          </div>
          <h3>{findLesson(progress.lastLessonId).title}</h3>
          <p className="muted">
            {findLesson(progress.lastLessonId).duration} · teori dan praktik
          </p>
          <button className="outline-button full" onClick={onContinue}>
            Buka pelajaran <ArrowRight size={15} />
          </button>
        </section>
      </div>
    </div>
  );
}
function ClockIcon() {
  return <Circle size={25} />;
}
function Stat({
  icon,
  label,
  value,
  detail,
  progress,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  progress?: number;
}) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-detail">{detail}</div>
      {progress !== undefined && (
        <div className="stat-progress">
          <span style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}

function LessonPage({
  lesson,
  progress,
  update,
  runSql,
  notify,
  onPage,
}: {
  lesson: Lesson;
  progress: AppProgress;
  update: (fn: (p: AppProgress) => AppProgress) => void;
  runSql: RunSql;
  notify: (message: string) => void;
  onPage: (page: Page) => void;
}) {
  const state = progress.lessons[lesson.id] ?? {
    status: "not-started" as const,
    attempts: 0,
    passed: false,
    score: 0,
    draft: lesson.starter,
    hintsUsed: 0,
    updatedAt: "",
  };
  const [query, setQuery] = useState(state.draft || lesson.starter);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState("");
  const [hint, setHint] = useState(0);
  const [showSolution, setShowSolution] = useState(false);
  useEffect(() => {
    setQuery(progress.lessons[lesson.id]?.draft || lesson.starter);
    setResult(null);
    setError("");
    setHint(0);
    setShowSolution(false);
  }, [lesson.id, lesson.starter]);
  const saveDraft = (value: string) => {
    setQuery(value);
    update((p) => ({
      ...p,
      lessons: {
        ...p.lessons,
        [lesson.id]: {
          ...state,
          draft: value,
          status: "learning",
          updatedAt: new Date().toISOString(),
        },
      },
    }));
  };
  const execute = async (evaluate: boolean) => {
    setError("");
    if (evaluate) {
      update((p) => ({
        ...p,
        lessons: {
          ...p.lessons,
          [lesson.id]: {
            ...(p.lessons[lesson.id] ?? state),
            attempts: (p.lessons[lesson.id]?.attempts ?? 0) + 1,
            draft: query,
            hintsUsed: Math.max(p.lessons[lesson.id]?.hintsUsed ?? 0, hint),
            updatedAt: new Date().toISOString(),
          },
        },
      }));
    }
    try {
      if (!evaluate)
        setResult(
          await runSql<QueryResult>({
            action: "query",
            dataset: lesson.id === "l6" ? "retail" : "small",
            sql: query,
          }),
        );
      else {
        const checked = await runSql<{
          passed: boolean;
          message: string;
          result: QueryResult;
        }>({
          action: "evaluate",
          dataset: lesson.id === "l6" ? "retail" : "small",
          sql: query,
          reference: lesson.solution,
          ordered: ["l1", "l2", "l3", "l4", "l6"].includes(lesson.id),
        });
        setResult(checked.result);
        if (!checked.passed) setError(checked.message);
        else {
          update((p) => ({
            ...p,
            lessons: {
              ...p.lessons,
              [lesson.id]: {
                ...(p.lessons[lesson.id] ?? state),
                status: "completed",
                passed: true,
                score: showSolution ? 0 : Math.max(0, 100 - hint * 10),
                solutionViewed: showSolution || p.lessons[lesson.id]?.solutionViewed,
                draft: query,
                attempts: p.lessons[lesson.id]?.attempts ?? state.attempts + 1,
                hintsUsed: hint,
                updatedAt: new Date().toISOString(),
              },
            },
            activities: [
              {
                id: crypto.randomUUID(),
                text: `Menyelesaikan: ${lesson.title}`,
                at: new Date().toISOString(),
              },
              ...p.activities,
            ].slice(0, 20),
          }));
          notify("Hasil latihan sesuai. Periksa indikator penyimpanan sebelum menutup halaman.");
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Kueri tidak valid.");
    }
  };
  return (
    <div className="page-wrap lesson-page">
      <div className="breadcrumb">
        Materi SQL <ArrowRight size={13} /> Modul{" "}
        {modules.find((item) => item.id === lesson.moduleId)?.number}{" "}
        <ArrowRight size={13} /> <strong>{lesson.title}</strong>
      </div>
      <div className="lesson-layout">
        <article className="lesson-content">
          <div className="lesson-title-row">
            <div>
              <div className="lesson-tag">
                MODUL{" "}
                {modules.find((item) => item.id === lesson.moduleId)?.number} ·{" "}
                {lesson.level.toUpperCase()}
              </div>
              <h1>{lesson.title}</h1>
              <p className="muted">
                {lesson.duration} · Teori, praktik & evaluasi
              </p>
            </div>
            {state.passed && (
              <span className="completed-pill">
                <CheckCircle2 size={15} /> Selesai
              </span>
            )}
          </div>
          <Section title="Tujuan pembelajaran">
            <div className="objective-box">
              <Lightbulb size={20} />
              <p>{lesson.objective}</p>
            </div>
          </Section>
          <Section title="Penjelasan teori">
            {lesson.theory.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </Section>
          <Section title="Sintaks SQL">
            <CodeBlock code={lesson.syntax} />
          </Section>
          <Section title="Contoh kasus & kode">
            <p>{lesson.explanation}</p>
            <CodeBlock code={lesson.example} />
          </Section>
          <Section title="SQL Playground">
            <div className="section-kicker">
              <Code2 size={16} /> PRAKTIK LANGSUNG
            </div>
            <p>{lesson.exercise}</p>
            <SqlEditor value={query} onChange={saveDraft} />
            <div className="editor-actions">
              <button
                className="primary-button"
                onClick={() => void execute(false)}
              >
                <Play size={16} fill="currentColor" /> Jalankan kueri
              </button>
              <button
                className="outline-button"
                onClick={() => saveDraft(lesson.starter)}
              >
                <RotateCcw size={15} /> Reset
              </button>
              <button
                className="outline-button"
                onClick={() => saveDraft(lesson.example)}
              >
                Isi contoh
              </button>
            </div>
            {error && (
              <div className="error-box">
                <X size={17} />
                {error}
              </div>
            )}
            {result && <ResultTable result={result} />}
          </Section>
          <Section title="Evaluasi otomatis">
            <div className="evaluation-box">
              <p>{lesson.criteria}</p>
              <div className="hint-row">
                {lesson.hints.map((text, index) => (
                  <button
                    className="hint-button"
                    key={text}
                    onClick={() => setHint(index + 1)}
                  >
                    <HelpCircle size={15} /> Petunjuk {index + 1}
                  </button>
                ))}
              </div>
              {hint > 0 && (
                <p className="hint-text">{lesson.hints[hint - 1]}</p>
              )}
              {showSolution ? (
                <CodeBlock code={lesson.solution} />
              ) : (
                <button
                  className="text-button"
                  onClick={() => setShowSolution(true)}
                >
                  Lihat pembahasan & solusi referensi
                </button>
              )}
              <button
                className="primary-button evaluation-button"
                onClick={() => void execute(true)}
              >
                <CheckCircle2 size={16} /> Periksa jawaban
              </button>
            </div>
          </Section>
          <Section title="Ringkasan">
            <ul className="summary-list">
              {lesson.summary.map((item) => (
                <li key={item}>
                  <CheckCircle2 size={16} />
                  {item}
                </li>
              ))}
            </ul>
          </Section>
        </article>
        <aside className="lesson-aside">
          <div className="toc-card">
            <div className="toc-title">DALAM PELAJARAN INI</div>
            {[
              "Tujuan pembelajaran",
              "Penjelasan teori",
              "Sintaks SQL",
              "Contoh kasus & kode",
              "SQL Playground",
              "Evaluasi otomatis",
              "Ringkasan",
            ].map((item, index) => (
              <div
                className={index === 4 ? "toc-item active" : "toc-item"}
                key={item}
              >
                <span>{index + 1}</span>
                {item}
              </div>
            ))}
          </div>
          <div className="progress-card">
            <strong>
              {state.passed
                ? "100%"
                : state.status === "learning"
                  ? "35%"
                  : "0%"}
            </strong>
            <div className="wide-progress">
              <span
                style={{
                  width: state.passed
                    ? "100%"
                    : state.status === "learning"
                      ? "35%"
                      : "0%",
                }}
              />
            </div>
            <p>
              {state.passed
                ? "Pelajaran selesai."
                : "Selesaikan latihan untuk menandai selesai."}
            </p>
          </div>
          <button
            className="outline-button full"
            onClick={() => onPage("playground")}
          >
            <Table2 size={16} /> Buka schema browser
          </button>
        </aside>
      </div>
    </div>
  );
}
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="learning-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
function CodeBlock({ code }: { code: string }) {
  return (
    <div className="code-block">
      <pre>{code}</pre>
      <button
        aria-label="Salin kode"
        onClick={() => void navigator.clipboard?.writeText(code)}
      >
        <Code2 size={14} />
      </button>
    </div>
  );
}
function SqlEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const callback = useRef(onChange);
  callback.current = onChange;
  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        sql(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callback.current(update.state.doc.toString());
        }),
      ],
    });
    view.current = new EditorView({ state, parent: host.current });
    return () => {
      view.current?.destroy();
      view.current = null;
    };
  }, []);
  useEffect(() => {
    if (view.current && view.current.state.doc.toString() !== value)
      view.current.dispatch({
        changes: { from: 0, to: view.current.state.doc.length, insert: value },
      });
  }, [value]);
  return <div className="sql-editor" ref={host} />;
}
function ResultTable({ result }: { result: QueryResult }) {
  return (
    <div className="result-wrap">
      <div className="result-meta">
        <span>
          <Table2 size={14} /> {result.rowCount} baris
          {result.truncated ? " ditampilkan (terpotong)" : ""}
        </span>
        <span>{result.durationMs} ms</span>
      </div>
      {result.columns.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {result.columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.values.map((row, index) => (
                <tr key={index}>
                  {row.map((value, cell) => (
                    <td
                      className={value === null ? "null-value" : ""}
                      key={cell}
                    >
                      {value === null ? "NULL" : String(value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-result">
          Kueri berhasil tetapi tidak menghasilkan tabel.
        </div>
      )}
    </div>
  );
}

function Playground({
  runSql,
  notify,
}: {
  runSql: RunSql;
  notify: (message: string) => void;
}) {
  const [query, setQuery] = useState(
    "SELECT name, city\nFROM customers\nWHERE city IS NOT NULL\nORDER BY name\nLIMIT 10;",
  );
  const [result, setResult] = useState<QueryResult | null>(null);
  const [schema, setSchema] = useState<
    Array<{
      name: string;
      description: string;
      columns: Array<{ name: string; type: string; description: string }>;
    }>
  >([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"result" | "schema">("result");
  useEffect(() => {
    void runSql<
      Array<{
        name: string;
        description: string;
        columns: Array<{ name: string; type: string; description: string }>;
      }>
    >({ action: "schema", dataset: "retail" })
      .then(setSchema)
      .catch(() => undefined);
  }, [runSql]);
  const execute = () => {
    setError("");
    void runSql<QueryResult>({ action: "query", dataset: "retail", sql: query })
      .then((value) => {
        setResult(value);
        setTab("result");
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "Kueri gagal."),
      );
  };
  return (
    <div className="page-wrap">
      <PageHeading
        eyebrow="LABORATORIUM SQL"
        title="SQL Playground"
        description="Eksperimen bebas menggunakan dataset retail sintetis. Kueri dijalankan oleh SQLite di browser."
        action={
          <button
            className="outline-button"
            onClick={() => {
              setQuery("");
              setResult(null);
              notify("Editor direset.");
            }}
          >
            <RotateCcw size={15} /> Reset
          </button>
        }
      />
      <div className="playground-layout">
        <section className="panel editor-panel">
          <div className="editor-topbar">
            <span>
              <span className="sql-dot">●</span> query.sql
            </span>
            <span className="dataset-label">
              <Database size={14} /> retail-synthetic-v1
            </span>
          </div>
          <SqlEditor value={query} onChange={setQuery} />
          <div className="editor-footer">
            <span>SQLite · read-only</span>
            <button className="primary-button" onClick={execute}>
              <Play size={15} fill="currentColor" /> Jalankan kueri
            </button>
          </div>
          {error && (
            <div className="error-box">
              <X size={17} />
              {error}
            </div>
          )}
        </section>
        <section className="panel output-panel">
          <div className="output-tabs">
            <button
              className={tab === "result" ? "output-tab active" : "output-tab"}
              onClick={() => setTab("result")}
            >
              Hasil kueri
            </button>
            <button
              className={tab === "schema" ? "output-tab active" : "output-tab"}
              onClick={() => setTab("schema")}
            >
              <Table2 size={15} /> Schema browser
            </button>
          </div>
          {tab === "result" ? (
            result ? (
              <ResultTable result={result} />
            ) : (
              <div className="empty-output">
                <Code2 size={30} />
                <h3>Hasil kueri muncul di sini</h3>
                <p>Jalankan kueri untuk melihat data.</p>
              </div>
            )
          ) : (
            <div className="schema-list">
              {schema.map((table) => (
                <details key={table.name}>
                  <summary>
                    <Table2 size={15} /> <strong>{table.name}</strong>
                    <span>{table.description}</span>
                  </summary>
                  <div className="schema-detail">
                    <table>
                      <thead>
                        <tr>
                          <th>Kolom</th>
                          <th>Tipe</th>
                          <th>Deskripsi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {table.columns.map((column) => (
                          <tr key={column.name}>
                            <td>{column.name}</td>
                            <td>{column.type}</td>
                            <td>{column.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ))}
            </div>
          )}
        </section>
      </div>
      <div className="playground-note">
        <Lightbulb size={17} />
        <span>
          <strong>Tip:</strong> Gunakan <code>COUNT(DISTINCT order_id)</code>{" "}
          setelah JOIN ke order_details agar pesanan tidak terhitung
          berkali-kali.
        </span>
      </div>
    </div>
  );
}

function Practice({
  progress,
  onOpen,
}: {
  progress: AppProgress;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="page-wrap">
      <PageHeading
        eyebrow="LATIHAN MANDIRI"
        title="Uji kemampuanmu"
        description="Setiap latihan memberi umpan balik berdasarkan hasil kueri, bukan kecocokan teks."
      />
      <div className="practice-grid">
        {allLessons.map((lesson) => {
          const state = progress.lessons[lesson.id];
          return (
            <button
              className="practice-card"
              key={lesson.id}
              onClick={() => onOpen(lesson.id)}
            >
              <div className="practice-card-top">
                <span className="lesson-number">
                  {
                    modules.find((module) => module.id === lesson.moduleId)
                      ?.number
                  }
                </span>
                {state?.passed ? (
                  <CheckCircle2 className="passed" size={19} />
                ) : (
                  <Circle size={19} />
                )}
              </div>
              <h3>{lesson.title}</h3>
              <p>{lesson.exercise}</p>
              <div className="practice-card-footer">
                <span>{lesson.duration}</span>
                <span className={state?.passed ? "status-done" : ""}>
                  {state?.passed
                    ? "Selesai"
                    : state
                      ? "Sedang dipelajari"
                      : "Belum dimulai"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const portfolioStages = [
  [
    "Memahami bisnis & dataset",
    "Pelajari konteks retail, grain lima tabel, dan relasinya.",
    "SELECT name, city FROM customers LIMIT 5;",
  ],
  [
    "Eksplorasi data awal",
    "Kenali volume, status, periode, dan data yang belum lengkap.",
    "SELECT status, COUNT(*) AS jumlah FROM orders GROUP BY status;",
  ],
  [
    "KPI penjualan",
    "Hitung revenue, transaksi, dan rata-rata nilai transaksi.",
    "SELECT strftime('%Y-%m', o.order_date) AS bulan, COUNT(DISTINCT o.order_id) AS transaksi, SUM(od.quantity * od.unit_price - od.discount) AS revenue FROM orders o JOIN order_details od ON od.order_id = o.order_id WHERE o.status = 'completed' GROUP BY bulan ORDER BY bulan;",
  ],
  [
    "Produk & kategori terbaik",
    "Bandingkan kinerja produk dan kategori.",
    "SELECT p.name, SUM(od.quantity * od.unit_price - od.discount) AS revenue FROM products p JOIN order_details od ON od.product_id = p.product_id JOIN orders o ON o.order_id = od.order_id WHERE o.status = 'completed' GROUP BY p.product_id ORDER BY revenue DESC LIMIT 5;",
  ],
  [
    "Tren & segmentasi pelanggan",
    "Cari pola berdasarkan waktu, kota, dan frekuensi pembelian.",
    "SELECT c.city, COUNT(DISTINCT o.order_id) AS transaksi FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id AND o.status = 'completed' GROUP BY c.city ORDER BY transaksi DESC;",
  ],
  [
    "Validasi kualitas data",
    "Periksa NULL, email duplikat, pelanggan tanpa order, dan relasi.",
    "SELECT email, COUNT(*) AS jumlah FROM customers WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1;",
  ],
  [
    "Insight & rekomendasi",
    "Pisahkan fakta, interpretasi, dan tindakan bisnis.",
    "-- Insight berdasarkan hasil query:\n-- Rekomendasi berdasarkan insight:",
  ],
  [
    "Dokumentasi GitHub",
    "Susun README dengan konteks, metodologi, query, hasil, dan batasan.",
    "# Analisis Penjualan Retail\n\n## Pertanyaan bisnis\n\n## Metodologi\n",
  ],
];
function Portfolio({
  progress,
  update,
  runSql,
  notify,
}: {
  progress: AppProgress;
  update: (fn: (p: AppProgress) => AppProgress) => void;
  runSql: RunSql;
  notify: (message: string) => void;
}) {
  const [stage, setStage] = useState(0);
  const [query, setQuery] = useState(portfolioStages[0][2]);
  const [result, setResult] = useState<QueryResult | null>(null);
  const current = portfolioStages[stage];
  const completed = Object.values(progress.portfolio).filter(
    (item) => item.status === "completed",
  ).length;
  const selectStage = (index: number) => {
    setStage(index);
    setQuery(portfolioStages[index][2]);
    setResult(null);
  };
  const execute = () => {
    void runSql<QueryResult>({ action: "query", dataset: "retail", sql: query })
      .then((value) => {
        setResult(value);
        update((p) => ({
          ...p,
          portfolio: {
            ...p.portfolio,
            [`stage-${stage}`]: {
              status: "completed",
              notes: "",
              query,
              result: {
                ...value,
                queryHash: query,
                datasetVersion: "retail-synthetic-v1",
              },
            },
          },
        }));
        notify("Hasil proyek tersimpan dengan versi dataset.");
      })
      .catch((reason) =>
        notify(reason instanceof Error ? reason.message : "Kueri gagal."),
      );
  };
  return (
    <div className="page-wrap">
      <PageHeading
        eyebrow="PROJECT LAB"
        title="Portofolio: Retail Insights"
        description="Studi kasus sintetis dari pertanyaan bisnis sampai dokumentasi GitHub."
        action={
          <div className="portfolio-progress">
            <strong>
              {Math.round((completed / portfolioStages.length) * 100)}%
            </strong>
            <span>proyek selesai</span>
          </div>
        }
      />
      <div className="portfolio-layout">
        <aside className="stage-list">
          {portfolioStages.map((item, index) => (
            <button
              className={stage === index ? "stage-item active" : "stage-item"}
              key={item[0]}
              onClick={() => selectStage(index)}
            >
              <span className="stage-index">
                {progress.portfolio[`stage-${index}`]?.status ===
                "completed" ? (
                  <CheckCircle2 size={16} />
                ) : (
                  index + 1
                )}
              </span>
              <span>{item[0]}</span>
            </button>
          ))}
        </aside>
        <section className="panel portfolio-work">
          <div className="lesson-tag">
            TAHAP {stage + 1} DARI {portfolioStages.length}
          </div>
          <h2>{current[0]}</h2>
          <p>{current[1]}</p>
          <div className="objective-box">
            <Lightbulb size={20} />
            <p>
              <strong>Tugas praktik:</strong> Jalankan query, baca hasilnya,
              lalu tuliskan insight berdasarkan angka yang benar-benar muncul.
            </p>
          </div>
          <SqlEditor value={query} onChange={setQuery} />
          <div className="editor-actions">
            <button className="primary-button" onClick={execute}>
              <Play size={16} fill="currentColor" /> Jalankan & simpan bukti
            </button>
            <button
              className="outline-button"
              onClick={() => setQuery(current[2])}
            >
              <RotateCcw size={15} /> Reset tahap
            </button>
          </div>
          {result && <ResultTable result={result} />}
          <textarea
            className="notes-area"
            placeholder="Catatan analisis, temuan, dan rekomendasi..."
            value={progress.portfolio[`stage-${stage}`]?.notes ?? ""}
            onChange={(event) =>
              update((p) => ({
                ...p,
                portfolio: {
                  ...p.portfolio,
                  [`stage-${stage}`]: {
                    ...(p.portfolio[`stage-${stage}`] ?? {
                      status: "available",
                      query: "",
                      notes: "",
                    }),
                    status:
                      p.portfolio[`stage-${stage}`]?.status ?? "available",
                    notes: event.target.value,
                    query: p.portfolio[`stage-${stage}`]?.query ?? "",
                  },
                },
              }))
            }
          />
          <div className="portfolio-disclaimer">
            <Database size={16} /> Angka hasil hanya berasal dari dataset
            sintetis lokal dan disimpan bersama query serta versi dataset.
          </div>
        </section>
      </div>
    </div>
  );
}

function SettingsPage({
  progress,
  update,
  notify,
}: {
  progress: AppProgress;
  update: (fn: (p: AppProgress) => AppProgress) => void;
  notify: (message: string) => void;
}) {
  const file = useRef<HTMLInputElement | null>(null);
  const exportData = () =>
    downloadText(
      `querycraft-backup-${new Date().toISOString().slice(0, 10)}.json`,
      serializeProgress(progress),
    );
  const importData = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = parseProgress(String(reader.result));
        if (window.confirm("Ganti progres saat ini dengan backup ini?")) {
          update(() => imported);
          notify("Progres berhasil diimpor.");
        }
      } catch (reason) {
        notify(
          reason instanceof Error ? reason.message : "Backup tidak valid.",
        );
      }
    };
    reader.readAsText(selected);
  };
  return (
    <div className="page-wrap">
      <PageHeading
        eyebrow="PENGATURAN"
        title="Pengaturan & backup"
        description="Kelola tampilan dan simpan progres agar tidak hilang ketika data browser dibersihkan."
      />
      <div className="settings-grid">
        <section className="panel settings-card">
          <div className="settings-icon">
            <Download size={20} />
          </div>
          <h2>Backup progres</h2>
          <p>
            Ekspor latihan, draf kueri, aktivitas, dan catatan portofolio ke
            file JSON.
          </p>
          <button className="primary-button" onClick={exportData}>
            <Download size={16} /> Ekspor progres
          </button>
          <button
            className="outline-button"
            onClick={() => file.current?.click()}
          >
            <Upload size={16} /> Impor progres
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json"
            hidden
            onChange={importData}
          />
          <small>
            Catatan: penyimpanan lokal terikat pada profil dan alamat browser.
            Backup dianjurkan secara berkala.
          </small>
        </section>
        <section className="panel settings-card">
          <div className="settings-icon">
            <Sun size={20} />
          </div>
          <h2>Tampilan</h2>
          <p>Gunakan tema yang nyaman untuk sesi belajar panjang.</p>
          <button
            className="outline-button"
            onClick={() =>
              update((p) => ({
                ...p,
                theme: p.theme === "dark" ? "light" : "dark",
              }))
            }
          >
            {progress.theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}{" "}
            Ganti tema
          </button>
          <small>
            SQL Analyst Academy berjalan lokal; fitur inti tidak membutuhkan
            akun atau cloud.
          </small>
        </section>
      </div>
      <div className="panel about-panel">
        <FileText size={19} />
        <div>
          <strong>QueryCraft · SQL Analyst Academy</strong>
          <p>
            SQLite di browser, dataset retail sintetis, evaluator berbasis
            hasil, dan IndexedDB untuk progres.
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;
