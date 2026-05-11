import Sidebar from "./Sidebar";
import DetailView from "./DetailView";
import ConfigEditor from "./ConfigEditor";
import GlobalStatusBar from "./GlobalStatusBar";
import Header from "./Header";

export default function Layout() {
  return (
    <div className="flex h-screen w-full flex-col bg-background">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
          <DetailView />
        </div>
      </div>
      <ConfigEditor />
      <GlobalStatusBar />
    </div>
  );
}
